import { DatabaseSync } from "node:sqlite";

import {
  Database,
  hasTile,
  initSchema,
  loadPois,
  loadTiles,
  savePois,
  savedTiles,
  saveTile,
} from "@/lib/db";
import { OsmNode, OsmWay, TileData } from "@/lib/osm";
import { TileId } from "@/lib/tiles";

/**
 * expo-sqlite と同じ形の口を node:sqlite で用意する。
 * 実機では expo-sqlite が入る。SQL そのものはここで確かめる。
 */
function memoryDatabase(): Database {
  const db = new DatabaseSync(":memory:");
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => {
      db.prepare(sql).run(...(params as any[]));
    },
    getAllAsync: async (sql, ...params) =>
      db.prepare(sql).all(...(params as any[])) as any[],
    getFirstAsync: async (sql, ...params) =>
      (db.prepare(sql).get(...(params as any[])) ?? null) as any,
  };
}

const TILE_A: TileId = { x: 6985, y: 1781 };
const TILE_B: TileId = { x: 6986, y: 1781 };

function node(id: number): OsmNode {
  return { id, lat: 35.62 + id * 0.0001, lon: 139.7 };
}

function way(id: number, nodes: number[], tags: Record<string, string> = {}): OsmWay {
  return { id, nodes, tags: { highway: "residential", ...tags } };
}

function data(ways: OsmWay[], nodes: OsmNode[]): TileData {
  return { ways, nodes };
}

async function fresh(): Promise<Database> {
  const db = memoryDatabase();
  await initSchema(db);
  return db;
}

describe("initSchema", () => {
  it("何度呼んでも落ちない", async () => {
    const db = memoryDatabase();
    await initSchema(db);
    await initSchema(db);
    expect(await savedTiles(db)).toEqual([]);
  });

  it("同じスキーマなら保存済みのデータを残す", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));

    await initSchema(db);

    expect(await savedTiles(db)).toEqual([TILE_A]);
    expect((await loadTiles(db, [TILE_A])).ways).toHaveLength(1);
  });

  it("古いスキーマの DB は作り直す", async () => {
    // 回帰テスト。列を変えたのに古い表が残り、
    // 「Calling the prepareAsync function has failed」になっていた。
    // 道路網は前処理で作り直せるので、捨ててよい
    const db = memoryDatabase();
    await db.execAsync(`
      PRAGMA user_version = 1;
      CREATE TABLE tiles (x INTEGER, y INTEGER, fetched_at INTEGER, PRIMARY KEY (x, y));
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, lat REAL, lon REAL);
      CREATE TABLE ways (id INTEGER PRIMARY KEY, node_ids TEXT, tags TEXT);
      CREATE TABLE way_tiles (way_id INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (way_id, x, y));
      CREATE TABLE node_tiles (node_id INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (node_id, x, y));
      INSERT INTO tiles VALUES (6985, 1781, 0);
    `);

    await initSchema(db);

    // 古いデータは消え、新しい形で書き込める
    expect(await savedTiles(db)).toEqual([]);
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));
    expect((await loadTiles(db, [TILE_A])).ways).toHaveLength(1);
  });

  it("バージョンが記録されていない古い DB も作り直す", async () => {
    // 回帰テスト。version を記録していなかった頃の DB は user_version が 0。
    // 0 を「まだ何も無い」と扱って作り直しを飛ばしたため、古い表が残り
    // 「no such column: w.highway」になっていた
    const db = memoryDatabase();
    await db.execAsync(`
      CREATE TABLE tiles (x INTEGER, y INTEGER, fetched_at INTEGER, PRIMARY KEY (x, y));
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, lat REAL, lon REAL);
      CREATE TABLE ways (id INTEGER PRIMARY KEY, node_ids TEXT, tags TEXT);
      CREATE TABLE way_tiles (way_id INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (way_id, x, y));
      INSERT INTO tiles VALUES (6985, 1781, 0);
    `);

    await initSchema(db);

    expect(await savedTiles(db)).toEqual([]);
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));
    expect((await loadTiles(db, [TILE_A])).ways).toHaveLength(1);
  });

  it("版数が合っていても、列が足りない表は作り直す", async () => {
    // 回帰テスト。実機で「table ways has no column named highway」が出た。
    // PRAGMA user_version が期待通り読めない環境があり得るため、
    // 版数を信用せず実際の表の形を確かめる
    const db = memoryDatabase();
    await db.execAsync(`
      PRAGMA user_version = 2;
      CREATE TABLE tiles (x INTEGER, y INTEGER, fetched_at INTEGER, PRIMARY KEY (x, y));
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, lat REAL, lon REAL);
      CREATE TABLE ways (id INTEGER PRIMARY KEY, node_ids TEXT, tags TEXT);
      CREATE TABLE way_tiles (way_id INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (way_id, x, y));
    `);

    await initSchema(db);

    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));
    expect((await loadTiles(db, [TILE_A])).ways).toHaveLength(1);
  });

  it("使わなくなった表を残さない", async () => {
    const db = memoryDatabase();
    await db.execAsync(`
      PRAGMA user_version = 1;
      CREATE TABLE node_tiles (node_id INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (node_id, x, y));
    `);

    await initSchema(db);

    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'node_tiles'",
    );
    expect(rows).toEqual([]);
  });

  it("タイルから way を引くのに ways を全走査しない", async () => {
    // 回帰テスト。way_tiles の主キーは (way_id, x, y) なので、
    // タイル側から引く索引が別に要る。無いと loadTiles が毎回
    // ways を頭から舐める。関東全域では 236 万行あり、
    // 探索 2 秒（requirements.md#5-非機能要件）を到底守れない
    const db = await fresh();

    const plan = await db.getAllAsync<{ detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT DISTINCT w.id, w.node_ids, w.highway, w.lanes
         FROM ways w
         JOIN way_tiles wt ON wt.way_id = w.id
        WHERE (wt.x, wt.y) IN (VALUES (?, ?))`,
      TILE_A.x,
      TILE_A.y,
    );
    const details = plan.map((p) => p.detail).join("\n");

    expect(details).not.toContain("SCAN w\n");
    expect(details).toContain("way_tiles_xy");
  });
});

describe("saveTile / hasTile", () => {
  it("保存したタイルを取得済みと判定する", async () => {
    const db = await fresh();
    expect(await hasTile(db, TILE_A)).toBe(false);

    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));

    expect(await hasTile(db, TILE_A)).toBe(true);
    expect(await hasTile(db, TILE_B)).toBe(false);
  });

  it("取得済みタイルを一覧できる", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([], []));
    await saveTile(db, TILE_B, data([], []));

    const tiles = await savedTiles(db);
    expect(tiles).toHaveLength(2);
    expect(tiles).toContainEqual(TILE_A);
    expect(tiles).toContainEqual(TILE_B);
  });

  it("同じタイルを二度保存しても重複しない", async () => {
    const db = await fresh();
    const tile = data([way(1, [10, 11])], [node(10), node(11)]);
    await saveTile(db, TILE_A, tile);
    await saveTile(db, TILE_A, tile);

    expect(await savedTiles(db)).toHaveLength(1);
    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways).toHaveLength(1);
    expect(loaded.nodes).toHaveLength(2);
  });
});

describe("loadTiles", () => {
  it("保存した way と node をそのまま返す", async () => {
    const db = await fresh();
    await saveTile(
      db,
      TILE_A,
      data([way(1, [10, 11, 12], { highway: "primary", lanes: "2" })], [
        node(10),
        node(11),
        node(12),
      ]),
    );

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways).toEqual([
      { id: 1, nodes: [10, 11, 12], tags: { highway: "primary", lanes: "2" } },
    ]);
    expect(loaded.nodes).toHaveLength(3);
    expect(loaded.nodes.find((n) => n.id === 10)).toEqual(node(10));
  });

  it("使うタグだけを保存する", async () => {
    // 経路探索が読むのは highway と lanes だけ。
    // タグ一式を JSON で持つと 1 タイルあたり 100KB 以上に膨らむ
    const db = await fresh();
    await saveTile(
      db,
      TILE_A,
      data(
        [way(1, [10, 11], { highway: "residential", name: "商店街", surface: "asphalt" })],
        [node(10), node(11)],
      ),
    );

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].tags).toEqual({ highway: "residential" });
  });

  it("lanes が無い way でも往復する", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].tags).toEqual({ highway: "residential" });
    expect(loaded.ways[0].tags.lanes).toBeUndefined();
  });

  it("座標が丸められずにそのまま往復する", async () => {
    // 圧縮のために座標を整数化すると丸めが入る。REAL のまま持つ
    const db = await fresh();
    const precise = { id: 10, lat: 35.6201234, lon: 139.7009876 };
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [precise, node(11)]));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.nodes.find((n) => n.id === 10)).toEqual(precise);
  });

  it("ノードを多く持つ way でも往復する", async () => {
    // 長さと順序が保たれること
    const ids = Array.from({ length: 200 }, (_, i) => 1000 + i);
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, ids)], ids.map(node)));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].nodes).toEqual(ids);
  });

  it("OSM の大きな ID でも往復する", async () => {
    // OSM のノード ID は 100 億を超える。32bit に収まらない
    const big = 12_345_678_901;
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [big, 11])], [{ id: big, lat: 35.62, lon: 139.7 }, node(11)]));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].nodes).toEqual([big, 11]);
    expect(loaded.nodes.find((n) => n.id === big)).toBeDefined();
  });

  it("未取得のタイルを指定しても落ちない", async () => {
    const db = await fresh();
    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways).toEqual([]);
    expect(loaded.nodes).toEqual([]);
  });

  it("タイルを指定しなければ空を返す", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));
    const loaded = await loadTiles(db, []);
    expect(loaded.ways).toEqual([]);
  });

  it("複数タイルをまとめて読める", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10), node(11)]));
    await saveTile(db, TILE_B, data([way(2, [12, 13])], [node(12), node(13)]));

    const loaded = await loadTiles(db, [TILE_A, TILE_B]);
    expect(loaded.ways.map((w) => w.id).sort()).toEqual([1, 2]);
    expect(loaded.nodes).toHaveLength(4);
  });

  it("境界をまたぐ way は、どちらのタイルからも読める", async () => {
    // way はタイルの外まで形状を持つため、
    // 隣り合うタイルには同じ way が入る。docs/design.md#23-タイル間の接続
    const db = await fresh();
    const shared = way(1, [10, 11]);
    await saveTile(db, TILE_A, data([shared], [node(10), node(11)]));
    await saveTile(db, TILE_B, data([shared], [node(10), node(11)]));

    expect((await loadTiles(db, [TILE_A])).ways).toHaveLength(1);
    expect((await loadTiles(db, [TILE_B])).ways).toHaveLength(1);
  });

  it("両方のタイルに含まれる way を二重に返さない", async () => {
    const db = await fresh();
    const shared = way(1, [10, 11]);
    await saveTile(db, TILE_A, data([shared], [node(10), node(11)]));
    await saveTile(db, TILE_B, data([shared], [node(10), node(11)]));

    const loaded = await loadTiles(db, [TILE_A, TILE_B]);
    expect(loaded.ways).toHaveLength(1);
    expect(loaded.nodes).toHaveLength(2);
  });

  it("way が参照する node は、別タイル由来でも揃う", async () => {
    // way は両タイルに入るが、node は片方のタイルにしか無いことがある
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [10, 11])], [node(10)]));
    await saveTile(db, TILE_B, data([way(1, [10, 11])], [node(11)]));

    const loaded = await loadTiles(db, [TILE_A, TILE_B]);
    expect(loaded.nodes.map((n) => n.id).sort()).toEqual([10, 11]);
  });
});

describe("footway の種別の保存", () => {
  it("footway の種別が往復する", async () => {
    // 歩道と横断歩道を区別できないと、コストモデルが大通り沿いの
    // 歩道を優遇してしまう（docs/design.md#111-footway-の-6-割は道路の付属物）
    const db = await fresh();
    await saveTile(
      db,
      TILE_A,
      data(
        [
          way(1, [1, 2], { highway: "footway", footway: "sidewalk" }),
          way(2, [2, 3], { highway: "footway", footway: "crossing" }),
        ],
        [node(1), node(2), node(3)],
      ),
    );

    const loaded = await loadTiles(db, [TILE_A]);
    const byId = new Map(loaded.ways.map((w) => [w.id, w.tags]));
    expect(byId.get(1)?.footway).toBe("sidewalk");
    expect(byId.get(2)?.footway).toBe("crossing");
  });

  it("footway タグが無い way でも往復する", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [1, 2])], [node(1), node(2)]));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].tags.footway).toBeUndefined();
  });
});

describe("沿っている幹線の保存", () => {
  it("歩道が沿う幹線の種別が往復する", async () => {
    // これが無いと、幹線沿いの歩道に幹線の係数を継がせられない
    // （docs/design.md#111-footway-の-6-割は道路の付属物）
    const db = await fresh();
    await saveTile(
      db,
      TILE_A,
      data(
        [way(1, [1, 2], { highway: "footway", footway: "sidewalk", along: "secondary" })],
        [node(1), node(2)],
      ),
    );

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].tags.along).toBe("secondary");
  });

  it("along が無い way でも往復する", async () => {
    const db = await fresh();
    await saveTile(db, TILE_A, data([way(1, [1, 2])], [node(1), node(2)]));

    const loaded = await loadTiles(db, [TILE_A]);
    expect(loaded.ways[0].tags.along).toBeUndefined();
  });
});

describe("地点（POI）の保存", () => {
  const shop = { name: "セブンイレブン", kind: "shop", lat: 35.6205, lon: 139.7005 };
  const park = { name: "林試の森公園", kind: "leisure", lat: 35.6215, lon: 139.7015 };

  it("地点を保存して、タイル単位で読める", async () => {
    const db = await fresh();
    await savePois(db, [shop, park]);

    const loaded = await loadPois(db, [TILE_A]);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.name).sort()).toEqual(["セブンイレブン", "林試の森公園"]);
  });

  it("別のタイルの地点は返さない", async () => {
    // 42 枚ぶん読むと 1 万件を超える。近くだけ引く
    const db = await fresh();
    await savePois(db, [shop]);

    expect(await loadPois(db, [TILE_B])).toEqual([]);
  });

  it("種別と座標がそのまま往復する", async () => {
    const db = await fresh();
    await savePois(db, [park]);

    const [loaded] = await loadPois(db, [TILE_A]);
    expect(loaded).toEqual(park);
  });

  it("タイルを指定しなければ空を返す", async () => {
    const db = await fresh();
    await savePois(db, [shop]);
    expect(await loadPois(db, [])).toEqual([]);
  });

  it("地点が入っていない古い DB でも落ちない", async () => {
    // POI を持たない頃に転送した DB を開いた場合
    const db = await fresh();
    expect(await loadPois(db, [TILE_A])).toEqual([]);
  });
});
