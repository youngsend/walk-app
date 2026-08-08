import {
  areConnected,
  buildGraph,
  distanceMeters,
  edgeNode,
  largestComponentSize,
  neighbors,
  reachableFrom,
} from "@/lib/graph";
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

  it("環状の way を弧に分ける", () => {
    // ロータリーや公園の周回路。他の道が繋がるノードで切る
    const g = buildGraph(tile([way(1, [1, 2, 3, 1]), way(2, [2, 4])], grid(4)));

    const ring = g.edges.filter((e) => e.wayId === 1);
    expect(ring.length).toBeGreaterThan(0);
    // 長さ 0 のループを作らない
    for (const e of ring) expect(e.from).not.toBe(e.to);
    // 環をたどって元に戻れる
    expect(areConnected(g, 1, 2)).toBe(true);
  });

  it("どこにも繋がらない環状路は落とす", () => {
    // 閉じた環だけで、他の way と共有するノードが無い形。
    // 切る場所が無く、経路としても到達できないので落として構わない
    const g = buildGraph(tile([way(1, [1, 2, 3, 1])], grid(3)));
    expect(g.edges).toHaveLength(0);
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

describe("reachableFrom", () => {
  it("繋がっているノードをすべて返す", () => {
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], grid(3)));
    expect([...reachableFrom(g, 1)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("出発点そのものを含む", () => {
    const g = buildGraph(tile([way(1, [1, 2])], grid(2)));
    expect(reachableFrom(g, 1).has(1)).toBe(true);
  });

  it("分断された先には届かない", () => {
    // 1-2 と 3-4 は繋がっていない
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [3, 4])], grid(4)));
    expect(reachableFrom(g, 1).has(3)).toBe(false);
    expect(reachableFrom(g, 1).size).toBe(2);
  });

  it("知らないノードからは空を返す", () => {
    const g = buildGraph(tile([way(1, [1, 2])], grid(2)));
    expect(reachableFrom(g, 999).size).toBe(0);
  });

  it("環状でも無限に回らない", () => {
    // 環をたどって出発点に戻ってくる形。訪問済みを覚えていないと終わらない
    const g = buildGraph(tile([way(1, [1, 2, 3, 1]), way(2, [2, 4])], grid(4)));
    const reached = reachableFrom(g, 1);

    expect(reached.has(1)).toBe(true);
    expect(reached.has(2)).toBe(true);
    expect(reached.has(4)).toBe(true);
  });
});

describe("areConnected", () => {
  it("繋がっていれば true", () => {
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], grid(3)));
    expect(areConnected(g, 1, 3)).toBe(true);
  });

  it("繋がっていなければ false", () => {
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [3, 4])], grid(4)));
    expect(areConnected(g, 1, 3)).toBe(false);
  });

  it("隣接タイル由来の way が 1 本に繋がる", () => {
    // ここが 1-5 の肝。Overpass は bbox の外まで含めた形状を返すので、
    // 隣り合うタイルには同じ way が入り、node ID が一致する。
    // タイル A の端（1）から、タイル B の端（5）まで辿れること
    const tileA = [way(1, [1, 2]), way(2, [2, 3])]; // 3 が境界のノード
    const tileB = [way(2, [2, 3]), way(3, [3, 4]), way(4, [4, 5])];
    // loadTiles は way ID で重複を排除するので、way 2 は 1 つだけになる
    const merged = new Map<number, OsmWay>();
    for (const w of [...tileA, ...tileB]) merged.set(w.id, w);

    const g = buildGraph(tile([...merged.values()], grid(5)));

    expect(areConnected(g, 1, 5)).toBe(true);
  });

  it("境界の node が片方のタイルにしか無くても繋がる", () => {
    // way は両タイルに入るが、node は片方にしか無いことがある。
    // loadTiles が両方から集めるので、グラフ上は繋がる
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], grid(3)));
    expect(areConnected(g, 1, 3)).toBe(true);
  });
});

describe("largestComponentSize", () => {
  it("最大の連結成分の大きさを返す", () => {
    // 1-2-3 の 3 つと、4-5 の 2 つ
    const g = buildGraph(
      tile([way(1, [1, 2]), way(2, [2, 3]), way(3, [4, 5])], grid(5)),
    );
    expect(largestComponentSize(g)).toBe(3);
  });

  it("空のグラフでは 0", () => {
    expect(largestComponentSize(buildGraph(tile([], [])))).toBe(0);
  });

  it("全て繋がっていればノード数と一致する", () => {
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], grid(3)));
    expect(largestComponentSize(g)).toBe(g.nodes.size);
  });
});

describe("edgeNode", () => {
  /** 経度だけを散らしたノード。id と経度が対応する */
  function spread(lons: number[]): OsmNode[] {
    return lons.map((lon, i) => ({ id: i + 1, lat: 35.63, lon }));
  }

  const TILE = { x: 6985, y: 1781 }; // 経度 139.70〜139.72

  it("タイル内で最も西のノードを返す", () => {
    const nodes = spread([139.705, 139.715, 139.71]);
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], nodes));
    expect(edgeNode(g, TILE, "west")).toBe(1);
  });

  it("タイル内で最も東のノードを返す", () => {
    const nodes = spread([139.705, 139.715, 139.71]);
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], nodes));
    expect(edgeNode(g, TILE, "east")).toBe(2);
  });

  it("タイルの外にあるノードは選ばない", () => {
    // 1 は隣のタイル（139.69）、2 と 3 がこのタイル内
    const nodes = spread([139.69, 139.705, 139.715]);
    const g = buildGraph(tile([way(1, [1, 2]), way(2, [2, 3])], nodes));
    expect(edgeNode(g, TILE, "west")).toBe(2);
  });

  it("タイル内にノードが無ければ undefined", () => {
    const nodes = spread([139.69, 139.68]);
    const g = buildGraph(tile([way(1, [1, 2])], nodes));
    expect(edgeNode(g, TILE, "west")).toBeUndefined();
  });

  it("空のグラフでも落ちない", () => {
    expect(edgeNode(buildGraph(tile([], [])), TILE, "west")).toBeUndefined();
  });
});
