import { ensureTiles } from "@/lib/tile-sync";
import { TileData } from "@/lib/overpass";
import { TileId, tileKey } from "@/lib/tiles";

const CENTER: TileId = { x: 6985, y: 1781 };

function sample(): TileData {
  return {
    ways: [{ id: 1, nodes: [10, 11], tags: { highway: "residential" } }],
    nodes: [
      { id: 10, lat: 35.62, lon: 139.7 },
      { id: 11, lat: 35.621, lon: 139.7 },
    ],
  };
}

/** 保存済みタイルを覚えるだけの入れ物。 */
function fakeStore(saved: TileId[] = []) {
  const have = new Set(saved.map(tileKey));
  const fetched: string[] = [];
  return {
    have,
    fetched,
    hasTile: async (t: TileId) => have.has(tileKey(t)),
    saveTile: async (t: TileId) => {
      have.add(tileKey(t));
    },
    fetchTile: async (t: TileId) => {
      fetched.push(tileKey(t));
      return sample();
    },
  };
}

describe("ensureTiles", () => {
  it("未取得のタイルだけ取得する", async () => {
    const store = fakeStore([CENTER]);
    const target = [CENTER, { x: CENTER.x + 1, y: CENTER.y }];

    await ensureTiles(target, store);

    expect(store.fetched).toEqual([tileKey({ x: CENTER.x + 1, y: CENTER.y })]);
  });

  it("すべて取得済みなら通信しない", async () => {
    const store = fakeStore([CENTER]);
    await ensureTiles([CENTER], store);
    expect(store.fetched).toEqual([]);
  });

  it("取得したタイルを保存する", async () => {
    const store = fakeStore();
    await ensureTiles([CENTER], store);
    expect(await store.hasTile(CENTER)).toBe(true);
  });

  it("1 枚失敗しても残りを続ける", async () => {
    // Overpass はタイルによって 504 を返すことがある
    const store = fakeStore();
    const east = { x: CENTER.x + 1, y: CENTER.y };
    const failing = {
      ...store,
      fetchTile: async (t: TileId) => {
        if (tileKey(t) === tileKey(CENTER)) throw new Error("504");
        store.fetched.push(tileKey(t));
        return sample();
      },
    };

    const result = await ensureTiles([CENTER, east], failing);

    expect(result.fetched).toEqual([east]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].tile).toEqual(CENTER);
  });

  it("取得できるかを聞いてから通信する", async () => {
    // モバイル通信中は自動取得しない（F-8）
    const store = fakeStore();
    const result = await ensureTiles([CENTER], store, { canFetch: () => false });

    expect(store.fetched).toEqual([]);
    expect(result.skipped).toEqual([CENTER]);
  });

  it("進捗を報告する", async () => {
    const store = fakeStore();
    const seen: number[] = [];
    const east = { x: CENTER.x + 1, y: CENTER.y };

    await ensureTiles([CENTER, east], store, {
      onProgress: (done, total) => {
        seen.push(done);
        expect(total).toBe(2);
      },
    });

    expect(seen).toEqual([1, 2]);
  });

  it("空の一覧でも落ちない", async () => {
    const store = fakeStore();
    const result = await ensureTiles([], store);
    expect(result.fetched).toEqual([]);
  });
});
