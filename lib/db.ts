import { OsmNode, OsmWay, TileData } from "./osm";
import { TileId } from "./tiles";

/**
 * 道路網をタイル単位で端末内に保存する。docs/design.md#4-データ保存
 *
 * 保存するのは生の way / node で、グラフではない。
 * グラフは「読み込んだタイル全体」から組み立てる必要があるため
 * （あるノードが交差点かどうかは、隣のタイルを読んだ時点で変わる）、
 * タイルごとにエッジを作って保存すると隣を足したときに辻褄が合わなくなる。
 *
 * way も node も OSM の ID を主キーにする。way は構成ノードが入るタイル
 * すべてに入るので隣り合うタイルには同じ way が現れるが、
 * ID が同じなら上書きされて重複しない（docs/design.md#23-タイル間の接続）。
 *
 * 無駄を削って 1 タイル 784KB → 404KB（実測）。削ったのは 2 つだけで、
 * **精度は一切落としていない**。
 * - node とタイルの対応表をやめた。way の node 参照から辿れるため不要で、
 *   node 1 件ごとの行が全体の 3 割を占めていた
 * - way のタグは経路探索が読む highway / lanes / footway / along だけを列に持つ。
 *   name や surface は保存しない（読む側がいない）
 *
 * 座標は REAL のまま。整数化すれば 1 割ほど縮むが、丸めが入るのでやめた。
 */

/** expo-sqlite と node:sqlite の両方を受けるための最小の口。 */
export type Database = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: any[]): Promise<unknown>;
  getAllAsync<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, ...params: any[]): Promise<T | null>;
};

/**
 * スキーマを変えたら上げる。上げると端末の DB は作り直される。
 * 道路網は前処理で作り直せるので、移行はしない。
 *
 * 1: 最初の形（tags を JSON、node ごとのタイル対応表あり）
 * 2: 使うタグだけを列に。node_tiles を廃止
 * 3: footway の種別を持たせた。歩道・横断歩道を歩行者専用道と
 *    区別しないと、大通り沿いの歩道が最も安い道になってしまう
 *    （docs/design.md#111-footway-の-6-割は道路の付属物）
 * 4: 歩道が沿っている幹線の種別（along）を持たせた。幹線に減点しても
 *    歩行者は並走する歩道を通るので、歩道が親の係数を継がないと
 *    減点が丸ごと迂回される
 */
const SCHEMA_VERSION = 4;

const TABLES = ["tiles", "nodes", "ways", "way_tiles", "node_tiles"];

/**
 * 今の DB が使える形かどうか。
 *
 * 版数（`PRAGMA user_version`）だけを見ると、それが読めない環境で
 * 判定を誤る。実機で「table ways has no column named highway」が出たため、
 * **実際の表の形を確かめる**ようにした。
 */
async function isUsable(db: Database): Promise<boolean> {
  try {
    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(ways)");
    if (columns.length === 0) return true; // まだ何も無い

    const names = new Set(columns.map((c) => c.name));
    return REQUIRED_WAY_COLUMNS.every((c) => names.has(c));
  } catch {
    // 形を確かめられないなら、作り直したほうが安全
    return false;
  }
}

const REQUIRED_WAY_COLUMNS = ["id", "node_ids", "highway", "lanes", "footway", "along"];

export async function initSchema(db: Database): Promise<void> {
  // 使えない形なら作り直す。道路網は取り直せるので移行はしない。
  // 何も無い DB なら DROP は空振りするだけで害はない
  if (!(await isUsable(db))) {
    await db.execAsync(TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join("\n"));
  }

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tiles (
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (x, y)
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ways (
      id INTEGER PRIMARY KEY,
      node_ids TEXT NOT NULL,
      highway TEXT NOT NULL,
      lanes REAL,
      -- highway=footway のときの footway= の値（sidewalk / crossing など）
      footway TEXT,
      -- 歩道が沿っている幹線の種別。前処理が空間的に求める（lib/sidepath.ts）
      along TEXT
    );

    -- way はタイルをまたぐので多対多にする。
    -- node には同じ表を作らない。way の node 参照から辿れるため不要で、
    -- 実測では node 1 件ごとの行が全体の 3 割を占めていた
    CREATE TABLE IF NOT EXISTS way_tiles (
      way_id INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      PRIMARY KEY (way_id, x, y)
    );

    -- 主キーは way_id が先頭なので、タイル側から引くにはこれが要る。
    -- 無いと loadTiles が ways を全走査する（関東全域で 236 万行）
    CREATE INDEX IF NOT EXISTS way_tiles_xy ON way_tiles (x, y);
  `);

  // 使わなくなった表を残さない
  await db.execAsync("DROP TABLE IF EXISTS node_tiles;");
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export async function saveTile(
  db: Database,
  tile: TileId,
  data: TileData,
  fetchedAt: number = Date.now(),
): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO tiles (x, y, fetched_at) VALUES (?, ?, ?)",
    tile.x,
    tile.y,
    fetchedAt,
  );

  for (const n of data.nodes) {
    await db.runAsync(
      "INSERT OR REPLACE INTO nodes (id, lat, lon) VALUES (?, ?, ?)",
      n.id,
      n.lat,
      n.lon,
    );
  }

  for (const w of data.ways) {
    const lanes = parseFloat(w.tags.lanes);
    await db.runAsync(
      "INSERT OR REPLACE INTO ways (id, node_ids, highway, lanes, footway, along) VALUES (?, ?, ?, ?, ?, ?)",
      w.id,
      JSON.stringify(w.nodes),
      w.tags.highway ?? "",
      Number.isFinite(lanes) ? lanes : null,
      w.tags.footway ?? null,
      w.tags.along ?? null,
    );
    await db.runAsync(
      "INSERT OR REPLACE INTO way_tiles (way_id, x, y) VALUES (?, ?, ?)",
      w.id,
      tile.x,
      tile.y,
    );
  }
}

export async function hasTile(db: Database, tile: TileId): Promise<boolean> {
  const row = await db.getFirstAsync<{ x: number }>(
    "SELECT x FROM tiles WHERE x = ? AND y = ?",
    tile.x,
    tile.y,
  );
  return row !== null;
}

export async function savedTiles(db: Database): Promise<TileId[]> {
  const rows = await db.getAllAsync<{ x: number; y: number }>(
    "SELECT x, y FROM tiles ORDER BY x, y",
  );
  return rows.map((r) => ({ x: r.x, y: r.y }));
}

/** 指定したタイルに含まれる way と、それが参照する node をまとめて返す。 */
export async function loadTiles(db: Database, tiles: TileId[]): Promise<TileData> {
  if (tiles.length === 0) return { ways: [], nodes: [] };

  const placeholders = tiles.map(() => "(? , ?)").join(", ");
  const params = tiles.flatMap((t) => [t.x, t.y]);

  const wayRows = await db.getAllAsync<{
    id: number;
    node_ids: string;
    highway: string;
    lanes: number | null;
    footway: string | null;
    along: string | null;
  }>(
    `SELECT DISTINCT w.id, w.node_ids, w.highway, w.lanes, w.footway, w.along
       FROM ways w
       JOIN way_tiles wt ON wt.way_id = w.id
      WHERE (wt.x, wt.y) IN (VALUES ${placeholders})`,
    ...params,
  );

  const ways: OsmWay[] = wayRows.map((r) => {
    const tags: Record<string, string> = { highway: r.highway };
    if (r.lanes !== null) tags.lanes = String(r.lanes);
    if (r.footway !== null) tags.footway = r.footway;
    if (r.along !== null) tags.along = r.along;
    return { id: r.id, nodes: JSON.parse(r.node_ids), tags };
  });

  // way が参照する node を、どのタイル由来かに関係なく集める。
  // 境界をまたぐ way は片側のタイルにしか無い node を指すことがある
  const wanted = new Set<number>();
  for (const w of ways) for (const id of w.nodes) wanted.add(id);
  if (wanted.size === 0) return { ways, nodes: [] };

  const ids = [...wanted];
  const nodes: OsmNode[] = [];
  // SQLite の変数上限（既定 999）に収まる大きさに分ける
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await db.getAllAsync<OsmNode>(
      `SELECT id, lat, lon FROM nodes WHERE id IN (${chunk.map(() => "?").join(",")})`,
      ...chunk,
    );
    nodes.push(...rows);
  }

  return { ways, nodes };
}
