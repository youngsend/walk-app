import { OsmNode, OsmWay, TileData } from "./overpass";
import { TileId } from "./tiles";

/**
 * 道路網をタイル単位で端末内に保存する。docs/design.md#4-データ保存
 *
 * 保存するのは Overpass が返した生の way / node で、グラフではない。
 * グラフは「読み込んだタイル全体」から組み立てる必要があるため
 * （あるノードが交差点かどうかは、隣のタイルを読んだ時点で変わる）、
 * タイルごとにエッジを作って保存すると隣を足したときに辻褄が合わなくなる。
 *
 * way も node も OSM の ID を主キーにする。Overpass は bbox の外まで
 * 含めた形状を返すので隣り合うタイルには同じ way が入るが、
 * ID が同じなら上書きされて重複しない（docs/design.md#23-タイル間の接続）。
 */

/** expo-sqlite と node:sqlite の両方を受けるための最小の口。 */
export type Database = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: any[]): Promise<unknown>;
  getAllAsync<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, ...params: any[]): Promise<T | null>;
};

export async function initSchema(db: Database): Promise<void> {
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
      tags TEXT NOT NULL
    );

    -- way はタイルをまたぐので多対多にする
    CREATE TABLE IF NOT EXISTS way_tiles (
      way_id INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      PRIMARY KEY (way_id, x, y)
    );

    CREATE TABLE IF NOT EXISTS node_tiles (
      node_id INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      PRIMARY KEY (node_id, x, y)
    );
  `);
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
    await db.runAsync(
      "INSERT OR REPLACE INTO node_tiles (node_id, x, y) VALUES (?, ?, ?)",
      n.id,
      tile.x,
      tile.y,
    );
  }

  for (const w of data.ways) {
    await db.runAsync(
      "INSERT OR REPLACE INTO ways (id, node_ids, tags) VALUES (?, ?, ?)",
      w.id,
      JSON.stringify(w.nodes),
      JSON.stringify(w.tags),
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
    tags: string;
  }>(
    `SELECT DISTINCT w.id, w.node_ids, w.tags
       FROM ways w
       JOIN way_tiles wt ON wt.way_id = w.id
      WHERE (wt.x, wt.y) IN (VALUES ${placeholders})`,
    ...params,
  );

  const ways: OsmWay[] = wayRows.map((r) => ({
    id: r.id,
    nodes: JSON.parse(r.node_ids),
    tags: JSON.parse(r.tags),
  }));

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
