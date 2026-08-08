/**
 * 生成した DB に対して、Mac 上で経路を引いてみる。
 * docs/development-plan.md の Step 3-2 の完了の定義
 *
 *   npx tsx scripts/route-check.ts <walk.db> <出発 lat> <lon> <目的 lat> <lon>
 *
 * 実機に 700MB を転送する前に、DB が本当に使えるかを Mac で確かめる。
 * 端末側と同じ lib/ を通すので、ここで通れば実機でも通る。
 */
import { DatabaseSync } from "node:sqlite";

import { Database, loadTiles } from "../lib/db";
import { buildGraph, distanceMeters, nearestNode } from "../lib/graph";
import { findRoute, highwayBreakdown } from "../lib/route";
import { tilesForRoute } from "../lib/tiles";

const [, , dbPath, ...coords] = process.argv;
if (!dbPath || coords.length !== 4) {
  console.error(
    "使い方: npx tsx scripts/route-check.ts <walk.db> <出発 lat> <lon> <目的 lat> <lon>",
  );
  process.exit(1);
}

const [fromLat, fromLon, toLat, toLon] = coords.map(Number);
if ([fromLat, fromLon, toLat, toLon].some((n) => !Number.isFinite(n))) {
  console.error("座標は数値で指定する");
  process.exit(1);
}

const from = { lat: fromLat, lon: fromLon };
const to = { lat: toLat, lon: toLon };

/** expo-sqlite と同じ形の口を node:sqlite で用意する（lib/db.ts の Database）。 */
function wrap(path: string): Database {
  const db = new DatabaseSync(path, { readOnly: true });
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

async function main() {
  const db = wrap(dbPath);

  const straightKm = distanceMeters(from, to) / 1000;
  const tiles = tilesForRoute(from, to);
  console.log(`直線距離   : ${straightKm.toFixed(2)} km`);
  console.log(`読むタイル : ${tiles.length} 枚`);

  let t = Date.now();
  const data = await loadTiles(db, tiles);
  const loadMs = Date.now() - t;
  console.log(`読み込み   : ${loadMs} ms（way ${data.ways.length.toLocaleString()} / node ${data.nodes.length.toLocaleString()}）`);

  t = Date.now();
  const graph = buildGraph(data);
  const buildMs = Date.now() - t;
  console.log(`グラフ構築 : ${buildMs} ms（交差点 ${graph.nodes.size.toLocaleString()} / エッジ ${graph.edges.length.toLocaleString()}）`);

  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  if (start === undefined || goal === undefined) {
    console.error("グラフにノードが無い。タイルが入っていない範囲を指している");
    process.exit(1);
  }

  t = Date.now();
  const route = findRoute(graph, start, goal);
  const routeMs = Date.now() - t;

  if (!route) {
    console.log(`探索       : ${routeMs} ms`);
    console.log("経路が見つからない（川・線路などで分断されている）");
    return;
  }

  console.log(`探索       : ${routeMs} ms`);
  console.log();
  console.log(`総距離     : ${(route.distance / 1000).toFixed(2)} km`);
  console.log(`コスト     : ${route.cost.toFixed(0)}`);
  console.log(`直線比     : ${(route.distance / 1000 / straightKm).toFixed(2)} 倍`);
  console.log(`所要時間   : 約 ${Math.round(route.distance / 80)} 分（時速 4.8km 換算）`);
  console.log();
  console.log("highway 種別ごとの距離:");
  for (const [type, meters] of highwayBreakdown(route)) {
    const share = ((meters / route.distance) * 100).toFixed(1);
    console.log(`  ${type.padEnd(14)} ${(meters / 1000).toFixed(2)} km  (${share}%)`);
  }

  console.log();
  console.log(`合計 ${loadMs + buildMs + routeMs} ms（読み込み + 構築 + 探索）`);
}

main();
