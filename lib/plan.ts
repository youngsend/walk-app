import { Database, loadTiles } from "./db";
import { LatLon, buildGraph, nearestNode } from "./graph";
import { WalkedEdge, edgeKey } from "./history";
import { HistoryOptions, findRoute, highwayBreakdown, routeCoordinates } from "./route";
import { tilesForRoute } from "./tiles";

/**
 * 現在地から目的地までの経路を、DB から組み立てて返す。
 * docs/development-plan.md の Step 5
 *
 * **画面はロジックを持たない**（docs/design.md#モジュールの依存）ので、
 * 「タイルを選ぶ → 読む → グラフを組む → 探す → 座標列にする」を
 * ここにまとめてある。おかげで実機なしでテストできる。
 */

/** 徒歩の速さ。時速 4.8km。 */
const METERS_PER_MINUTE = 80;

export type PlanResult =
  | {
      ok: true;
      coordinates: LatLon[];
      distanceM: number;
      minutes: number;
      /** 距離 × 種別係数 × 履歴係数 の総和。効き具合を数字で見る */
      cost: number;
      /** 通る区間。「歩いたことにする」で記録する先 */
      walkedKeys: string[];
      walkedEdges: WalkedEdge[];
      /** 種別ごとの距離。幹線を避けられているかを数字で見る */
      breakdown: [string, number][];
      /** 読んだタイル数。応答時間の目安になる */
      tileCount: number;
      /** 各段の所要時間（ミリ秒）。どこが遅いかを画面で見る */
      timings: { loadMs: number; buildMs: number; searchMs: number };
    }
  | { ok: false; reason: "道路網なし" | "経路なし" };

/** 距離から徒歩の所要時間（分）。 */
export function walkingMinutes(meters: number): number {
  if (meters <= 0) return 0;
  return Math.max(1, Math.ceil(meters / METERS_PER_MINUTE));
}

export async function planRoute(
  db: Database,
  from: LatLon,
  to: LatLon,
  history?: HistoryOptions,
): Promise<PlanResult> {
  const tiles = tilesForRoute(from, to);

  let at = Date.now();
  const data = await loadTiles(db, tiles);
  const loadMs = Date.now() - at;

  at = Date.now();
  const graph = buildGraph(data);
  const buildMs = Date.now() - at;

  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  // 未投入か、関東の外を指している
  if (start === undefined || goal === undefined) return { ok: false, reason: "道路網なし" };

  at = Date.now();
  const route = findRoute(graph, start, goal, history);
  const searchMs = Date.now() - at;

  // 川や線路で分断された先
  if (!route) return { ok: false, reason: "経路なし" };

  return {
    ok: true,
    coordinates: routeCoordinates(route, start),
    distanceM: route.distance,
    minutes: walkingMinutes(route.distance),
    cost: route.cost,
    walkedKeys: route.edges.map(edgeKey),
    walkedEdges: route.edges.map((e) => ({ wayId: e.wayId, from: e.from, to: e.to })),
    breakdown: highwayBreakdown(route),
    tileCount: tiles.length,
    timings: { loadMs, buildMs, searchMs },
  };
}
