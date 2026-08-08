import { DatabaseSync } from "node:sqlite";

import {
  Database,
  hasTile,
  initSchema,
  loadTiles,
  savedTiles,
  saveTile,
} from "@/lib/db";
import { OsmNode, OsmWay, TileData } from "@/lib/overpass";
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
    // Overpass は bbox 外まで含めた完全な形状を返すため、
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
