import { edgeFactor } from "./cost";
import { OsmNode, OsmWay, TileData } from "./osm";
import { TileId, tileBounds } from "./tiles";

/**
 * OSM の way 列を経路探索できるグラフに変換する。
 * docs/development-plan.md の Step 1-2
 *
 * ノード = 交差点、エッジ = 交差点間の区間。
 * 1 本の way が途中で他の way と交わったら、そこで分割する。
 */

export type LatLon = { lat: number; lon: number };

export type Edge = {
  wayId: number;
  /** 両端の交差点ノード ID */
  from: number;
  to: number;
  /** 形状。両端の交差点を含む座標列 */
  geometry: LatLon[];
  /** メートル */
  length: number;
  highway: string;
  /** 距離に掛けるとコストになる。docs/design.md#13-コストモデル */
  factor: number;
};

export type Graph = {
  /** 交差点ノードのみ。way の途中の形状点は含まない */
  nodes: Map<number, OsmNode>;
  edges: Edge[];
  /** ノード ID → そこから伸びるエッジ。徒歩なので双方向 */
  adjacency: Map<number, Edge[]>;
};

const EARTH_RADIUS_M = 6371008.8;

/** 2 点間の球面距離（メートル）。 */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pathLength(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

export function buildGraph(data: TileData): Graph {
  const nodeById = new Map<number, OsmNode>();
  for (const n of data.nodes) nodeById.set(n.id, n);

  // 何本の way がそのノードを使っているか
  const useCount = new Map<number, number>();
  for (const way of data.ways) {
    for (const id of way.nodes) {
      useCount.set(id, (useCount.get(id) ?? 0) + 1);
    }
  }

  const nodes = new Map<number, OsmNode>();
  const edges: Edge[] = [];
  const adjacency = new Map<number, Edge[]>();

  const link = (nodeId: number, edge: Edge) => {
    const list = adjacency.get(nodeId);
    if (list) list.push(edge);
    else adjacency.set(nodeId, [edge]);
  };

  for (const way of data.ways) {
    // 座標が揃っている way だけを扱う
    const points = way.nodes.map((id) => nodeById.get(id));
    if (points.some((p) => p === undefined)) continue;
    if (way.nodes.length < 2) continue;

    const factor = edgeFactor(way.tags);
    const highway = way.tags.highway ?? "";

    // way の両端は必ず分割点。途中は 2 本以上に使われていれば交差点
    const isSplit = (index: number) =>
      index === 0 ||
      index === way.nodes.length - 1 ||
      (useCount.get(way.nodes[index]) ?? 0) >= 2;

    let startIndex = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      if (!isSplit(i)) continue;

      const from = way.nodes[startIndex];
      const to = way.nodes[i];
      // 同じ点に戻る区間（環状 way の閉じ目など）は捨てる
      if (from !== to) {
        const geometry = way.nodes
          .slice(startIndex, i + 1)
          .map((id) => nodeById.get(id)!)
          .map((n) => ({ lat: n.lat, lon: n.lon }));

        const edge: Edge = {
          wayId: way.id,
          from,
          to,
          geometry,
          length: pathLength(geometry),
          highway,
          factor,
        };
        edges.push(edge);
        nodes.set(from, nodeById.get(from)!);
        nodes.set(to, nodeById.get(to)!);
        link(from, edge);
        link(to, edge);
      }
      startIndex = i;
    }
  }

  return { nodes, edges, adjacency };
}

/** あるノードから直接行けるノードの ID。完了の定義の確認用。 */
export function neighbors(graph: Graph, nodeId: number): number[] {
  const list = graph.adjacency.get(nodeId) ?? [];
  return list.map((e) => (e.from === nodeId ? e.to : e.from));
}

/**
 * あるノードから辿り着けるノードの集合。出発点自身を含む。
 *
 * 隣接タイルが正しく繋がっているかを確かめるために使う
 * （docs/development-plan.md の Step 1-5）。
 * Step 2 の経路探索も同じ隣接リストを辿る。
 */
export function reachableFrom(graph: Graph, start: number): Set<number> {
  const seen = new Set<number>();
  if (!graph.nodes.has(start)) return seen;

  const stack = [start];
  seen.add(start);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of neighbors(graph, current)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/** 2 つのノードが繋がっているか。 */
export function areConnected(graph: Graph, a: number, b: number): boolean {
  return reachableFrom(graph, a).has(b);
}

/**
 * 最大の連結成分に含まれるノード数。
 * 全体のノード数と大きく離れていれば、グラフが分断されている。
 */
export function largestComponentSize(graph: Graph): number {
  const seen = new Set<number>();
  let largest = 0;

  for (const id of graph.nodes.keys()) {
    if (seen.has(id)) continue;
    const component = reachableFrom(graph, id);
    for (const member of component) seen.add(member);
    if (component.size > largest) largest = component.size;
  }
  return largest;
}

/**
 * タイルの中で最も西／東にあるノード。
 *
 * 隣接タイルが繋がっているかを「一方の端から他方の端まで辿れるか」で
 * 確かめるために使う（docs/development-plan.md の Step 1-5）。
 * 境界のすぐ近くではなく端どうしを選ぶことで、境界をまたいで
 * 実際にグラフが繋がっていることを確かめられる。
 */
export function edgeNode(
  graph: Graph,
  tile: TileId,
  side: "west" | "east",
): number | undefined {
  const bounds = tileBounds(tile);
  let best: number | undefined;
  let bestLon = side === "west" ? Infinity : -Infinity;

  for (const [id, node] of graph.nodes) {
    // Overpass は bbox の外まで返すので、タイル内のノードだけに絞る
    if (node.lat < bounds.south || node.lat >= bounds.north) continue;
    if (node.lon < bounds.west || node.lon >= bounds.east) continue;

    if (side === "west" ? node.lon < bestLon : node.lon > bestLon) {
      bestLon = node.lon;
      best = id;
    }
  }
  return best;
}
