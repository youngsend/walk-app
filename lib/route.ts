import { MIN_EDGE_FACTOR } from "./cost";
import { Edge, Graph, LatLon, distanceMeters } from "./graph";

/**
 * コスト最小の経路を探す。docs/design.md#14-探索アルゴリズム
 *
 * コスト = 各区間の `距離 × 種別係数`。距離が基礎にあるので遠回りは
 * 自然に不利になるが、係数を大きく振ることで幹線回避を優先させている。
 * 履歴係数は Step 6 で足す。
 *
 * 直線距離を推定値に使った A\* 法。推定値は実コスト以下でなければ
 * 最短性が壊れるので、係数の最小値（cost.ts の MIN_EDGE_FACTOR）を掛ける。
 *
 * **この値は cost.ts から導く。** 以前は 0.8 を直書きしていたが、
 * 車線補正 0.9 が掛かると 0.72 まで下がる区間が実データに 195 本あり、
 * 推定値が実コストを超えて最短性が崩れる状態だった。
 */

export type Route = {
  /** 通過するノード ID。出発点と目的地を含む */
  nodes: number[];
  edges: Edge[];
  /** メートル */
  distance: number;
  /** 距離 × 係数 の総和 */
  cost: number;
};

/** 優先度付きキュー。要素数が少ないので配列で十分。 */
class Queue {
  private items: { id: number; priority: number }[] = [];

  push(id: number, priority: number) {
    this.items.push({ id, priority });
  }

  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      if (this.items[i].priority < this.items[best].priority) best = i;
    }
    return this.items.splice(best, 1)[0].id;
  }

  get size() {
    return this.items.length;
  }
}

export function findRoute(graph: Graph, from: number, to: number): Route | null {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return null;
  if (from === to) return { nodes: [from], edges: [], distance: 0, cost: 0 };

  const goal = graph.nodes.get(to)!;
  /** 出発点からの確定コスト */
  const best = new Map<number, number>([[from, 0]]);
  /** どのエッジで来たか */
  const cameFrom = new Map<number, { node: number; edge: Edge }>();
  const settled = new Set<number>();

  const queue = new Queue();
  queue.push(from, 0);

  while (queue.size > 0) {
    const current = queue.pop()!;
    if (current === to) break;
    if (settled.has(current)) continue;
    settled.add(current);

    const currentCost = best.get(current)!;
    for (const edge of graph.adjacency.get(current) ?? []) {
      const next = edge.from === current ? edge.to : edge.from;
      if (settled.has(next)) continue;

      const cost = currentCost + edge.length * edge.factor;
      if (cost >= (best.get(next) ?? Infinity)) continue;

      best.set(next, cost);
      cameFrom.set(next, { node: current, edge });
      // 残りの直線距離に最小の係数を掛けたものは、実コストを超えない
      const heuristic = distanceMeters(graph.nodes.get(next)!, goal) * MIN_EDGE_FACTOR;
      queue.push(next, cost + heuristic);
    }
  }

  if (!cameFrom.has(to)) return null;

  const nodes: number[] = [to];
  const edges: Edge[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = cameFrom.get(cursor)!;
    edges.push(step.edge);
    cursor = step.node;
    nodes.push(cursor);
  }
  nodes.reverse();
  edges.reverse();

  return {
    nodes,
    edges,
    distance: edges.reduce((sum, e) => sum + e.length, 0),
    cost: best.get(to)!,
  };
}

/**
 * 地図に線を描くための座標列。
 *
 * エッジの geometry は way が描かれた向き（from → to）で入っているが、
 * 経路がその向きに進むとは限らない。**逆向きに通るエッジは反転しないと
 * 線が行ったり来たりする。** 継ぎ目の点は重複するので落とす。
 */
export function routeCoordinates(route: Route, start: number): LatLon[] {
  // 出発点と目的地が同じノードに寄った場合。線は引かない
  if (route.edges.length === 0) return [];

  const coordinates: LatLon[] = [];
  let cursor = start;
  for (const edge of route.edges) {
    const forward = edge.from === cursor;
    const geometry = forward ? edge.geometry : [...edge.geometry].reverse();
    // 継ぎ目は前のエッジの終点と同じ。2 本目からは先頭を落とす
    coordinates.push(...(coordinates.length === 0 ? geometry : geometry.slice(1)));
    cursor = forward ? edge.to : edge.from;
  }
  return coordinates;
}

/** 経路上の種別ごとの距離。距離の大きい順。 */
export function highwayBreakdown(route: Route): [string, number][] {
  const byType = new Map<string, number>();
  for (const edge of route.edges) {
    byType.set(edge.highway, (byType.get(edge.highway) ?? 0) + edge.length);
  }
  return [...byType.entries()].sort((a, b) => b[1] - a[1]);
}
