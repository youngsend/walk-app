import { buildGraph, distanceMeters, neighbors } from "@/lib/graph";
import { OsmNode, OsmWay, TileData } from "@/lib/overpass";

/**
 * 格子状のノードを用意する。id は 1 始まりで、
 * lat/lon はおおよそ 100m 刻みになるよう並べる。
 */
function grid(count: number): OsmNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    lat: 35.62 + i * 0.001,
    lon: 139.7,
  }));
}

function way(id: number, nodes: number[], tags: Record<string, string> = {}): OsmWay {
  return { id, nodes, tags: { highway: "residential", ...tags } };
}

function tile(ways: OsmWay[], nodes: OsmNode[]): TileData {
  return { ways, nodes };
}

describe("distanceMeters", () => {
  it("同じ点は 0", () => {
    const p = { lat: 35.62, lon: 139.7 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it("既知の距離とおおよそ合う", () => {
    // 東京駅 - 横浜駅 は約 27km
    const tokyo = { lat: 35.6812, lon: 139.7671 };
    const yokohama = { lat: 35.4657, lon: 139.622 };
    expect(distanceMeters(tokyo, yokohama) / 1000).toBeCloseTo(27.3, 0);
  });

  it("緯度 0.001 度はおよそ 111m", () => {
    const d = distanceMeters({ lat: 35.62, lon: 139.7 }, { lat: 35.621, lon: 139.7 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("向きを変えても同じ距離", () => {
    const a = { lat: 35.62, lon: 139.7 };
    const b = { lat: 35.63, lon: 139.71 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 9);
  });
});

describe("buildGraph", () => {
  it("交わらない 1 本の way は 1 エッジになる", () => {
    const g = buildGraph(tile([way(1, [1, 2, 3])], grid(3)));
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.size).toBe(2); // 両端だけがノード
    expect(g.edges[0].from).toBe(1);
    expect(g.edges[0].to).toBe(3);
  });

  it("途中の形状点をエッジの geometry に残す", () => {
    const g = buildGraph(tile([way(1, [1, 2, 3])], grid(3)));
    expect(g.edges[0].geometry).toHaveLength(3);
    expect(g.edges[0].length).toBeCloseTo(222, -1); // 0.002 度 ≒ 222m
  });

  it("他の way と共有するノードで分割する", () => {
    // way 1 の途中のノード 2 を way 2 が共有する
    const g = buildGraph(tile([way(1, [1, 2, 3]), way(2, [2, 4])], grid(4)));
    const fromWay1 = g.edges.filter((e) => e.wayId === 1);
    expect(fromWay1).toHaveLength(2);
    expect(fromWay1.map((e) => [e.from, e.to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(g.nodes.has(2)).toBe(true);
  });

  it("way の両端は共有されていなくてもノードになる", () => {
    const g = buildGraph(tile([way(1, [1, 2, 3])], grid(3)));
    expect(g.nodes.has(1)).toBe(true);
    expect(g.nodes.has(3)).toBe(true);
    expect(g.nodes.has(2)).toBe(false); // 途中の形状点は交差点ではない
  });

  it("種別ごとの係数をエッジに持たせる", () => {
    const g = buildGraph(
      tile([way(1, [1, 2], { highway: "primary", lanes: "2" })], grid(2)),
    );
    expect(g.edges[0].highway).toBe("primary");
    expect(g.edges[0].factor).toBeCloseTo(12.0);
  });

  it("孤立したノードを作らない", () => {
    const g = buildGraph(tile([way(1, [1, 2, 3]), way(2, [2, 4])], grid(4)));
    for (const id of g.nodes.keys()) {
      expect(neighbors(g, id).length).toBeGreaterThan(0);
    }
  });

  it("環状の way でも同じ点に戻る区間を作らない", () => {
    const nodes = grid(4);
    const g = buildGraph(tile([way(1, [1, 2, 3, 1])], nodes));
    for (const e of g.edges) {
      expect(e.from).not.toBe(e.to);
    }
  });

  it("座標が欠けた way は無視する", () => {
    // ノード 9 の座標が無い
    const g = buildGraph(tile([way(1, [1, 9])], grid(2)));
    expect(g.edges).toHaveLength(0);
  });

  it("ノードが 1 つしかない way は無視する", () => {
    const g = buildGraph(tile([way(1, [1])], grid(2)));
    expect(g.edges).toHaveLength(0);
  });

  it("空の入力でも落ちない", () => {
    const g = buildGraph(tile([], []));
    expect(g.edges).toHaveLength(0);
    expect(g.nodes.size).toBe(0);
  });
});

describe("neighbors", () => {
  it("両方向に辿れる", () => {
    const g = buildGraph(tile([way(1, [1, 2])], grid(2)));
    expect(neighbors(g, 1)).toEqual([2]);
    expect(neighbors(g, 2)).toEqual([1]);
  });

  it("交差点から全ての方向を列挙する", () => {
    // ノード 2 で 3 本が交わる
    const g = buildGraph(
      tile([way(1, [1, 2]), way(2, [2, 3]), way(3, [2, 4])], grid(4)),
    );
    expect(neighbors(g, 2).sort()).toEqual([1, 3, 4]);
  });

  it("知らないノードでは空を返す", () => {
    const g = buildGraph(tile([way(1, [1, 2])], grid(2)));
    expect(neighbors(g, 999)).toEqual([]);
  });
});
