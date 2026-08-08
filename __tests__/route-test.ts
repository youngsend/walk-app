import { buildGraph } from "@/lib/graph";
import { OsmNode, OsmWay, TileData } from "@/lib/osm";
import { findRoute, highwayBreakdown } from "@/lib/route";

/**
 * 目的地まで 2 通りの行き方があるグラフ。
 *
 *   1 ──── 幹線(primary) ────→ 4        直線で 400m
 *   1 → 2 → 3 → 4  生活道路(residential)   横にふくらんで 577m（1.44 倍）
 *
 * 種別係数が効いていれば、遠回りでも生活道路を選ぶ。
 * 係数を平らにすれば、短い幹線のほうが選ばれる。
 */
function twoRoutes(): TileData {
  const nodes: OsmNode[] = [
    { id: 1, lat: 35.62, lon: 139.7 },
    // 迂回路は東へふくらませる。まっすぐ並べると直線と同じ長さになり、
    // 係数を平らにしたときに引き分けになってしまう
    { id: 2, lat: 35.621, lon: 139.702 },
    { id: 3, lat: 35.622, lon: 139.702 },
    { id: 4, lat: 35.6236, lon: 139.7 }, // 1 から約 400m
  ];
  const ways: OsmWay[] = [
    { id: 100, nodes: [1, 4], tags: { highway: "primary" } },
    { id: 200, nodes: [1, 2], tags: { highway: "residential" } },
    { id: 201, nodes: [2, 3], tags: { highway: "residential" } },
    { id: 202, nodes: [3, 4], tags: { highway: "residential" } },
  ];
  return { ways, nodes };
}

/** 係数を平らにする（すべて 1.0）。距離だけで選ぶ状態 */
function flatten(data: TileData): TileData {
  return {
    nodes: data.nodes,
    ways: data.ways.map((w) => ({ ...w, tags: { highway: "residential" } })),
  };
}

describe("findRoute", () => {
  it("2 地点を繋ぐ経路を返す", () => {
    const route = findRoute(buildGraph(twoRoutes()), 1, 4);
    expect(route).not.toBeNull();
    expect(route!.nodes[0]).toBe(1);
    expect(route!.nodes[route!.nodes.length - 1]).toBe(4);
  });

  it("幹線を避けて生活道路を選ぶ", () => {
    // これがこのアプリの価値そのもの
    const route = findRoute(buildGraph(twoRoutes()), 1, 4);
    expect(route!.nodes).toEqual([1, 2, 3, 4]);
    expect(route!.edges.every((e) => e.highway === "residential")).toBe(true);
  });

  it("係数を平らにすると幹線を通る", () => {
    // 係数が経路を変えていることの裏付け。
    // 距離だけで選べば直線の幹線が最短になる
    const route = findRoute(buildGraph(flatten(twoRoutes())), 1, 4);
    expect(route!.nodes).toEqual([1, 4]);
  });

  it("遠回りのぶん距離は伸びる", () => {
    const avoiding = findRoute(buildGraph(twoRoutes()), 1, 4)!;
    const shortest = findRoute(buildGraph(flatten(twoRoutes())), 1, 4)!;
    expect(avoiding.distance).toBeGreaterThan(shortest.distance);
  });

  it("同じノードなら距離 0 の経路を返す", () => {
    const route = findRoute(buildGraph(twoRoutes()), 1, 1);
    expect(route!.nodes).toEqual([1]);
    expect(route!.distance).toBe(0);
  });

  it("繋がっていなければ null を返す", () => {
    const data = twoRoutes();
    // 4 から切り離した島を足す
    data.nodes.push({ id: 9, lat: 35.7, lon: 139.8 }, { id: 10, lat: 35.701, lon: 139.8 });
    data.ways.push({ id: 300, nodes: [9, 10], tags: { highway: "residential" } });

    expect(findRoute(buildGraph(data), 1, 9)).toBeNull();
  });

  it("知らないノードを指定したら null を返す", () => {
    expect(findRoute(buildGraph(twoRoutes()), 1, 999)).toBeNull();
  });

  it("距離とコストの両方を返す", () => {
    const route = findRoute(buildGraph(twoRoutes()), 1, 4)!;
    expect(route.distance).toBeGreaterThan(0);
    expect(route.cost).toBeGreaterThan(0);
    // 生活道路の係数は 1.0 なので、コストと距離が一致する
    expect(route.cost).toBeCloseTo(route.distance, 5);
  });

  it("幹線しか道が無ければ、やむを得ず通る", () => {
    // 川や線路で分断された地形を想定。禁止ではなく高コストで表現している
    const data: TileData = {
      nodes: [
        { id: 1, lat: 35.62, lon: 139.7 },
        { id: 2, lat: 35.6236, lon: 139.7 },
      ],
      ways: [{ id: 100, nodes: [1, 2], tags: { highway: "primary" } }],
    };
    const route = findRoute(buildGraph(data), 1, 2)!;

    expect(route.nodes).toEqual([1, 2]);
    // primary の係数は 8.0 なので、コストは距離の 8 倍になる
    expect(route.cost).toBeCloseTo(route.distance * 8, 3);
  });
});

describe("highwayBreakdown", () => {
  it("種別ごとの距離を返す", () => {
    const route = findRoute(buildGraph(twoRoutes()), 1, 4)!;
    const breakdown = highwayBreakdown(route);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0][0]).toBe("residential");
    expect(breakdown[0][1]).toBeCloseTo(route.distance, 5);
  });

  it("距離の大きい順に並べる", () => {
    const data = twoRoutes();
    // 1→2 だけ幹線にする
    data.ways[1].tags = { highway: "primary" };

    const route = findRoute(buildGraph(flatten(data)), 1, 4)!;
    const breakdown = highwayBreakdown(route);
    for (let i = 1; i < breakdown.length; i++) {
      expect(breakdown[i - 1][1]).toBeGreaterThanOrEqual(breakdown[i][1]);
    }
  });
});
