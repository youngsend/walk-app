import { LatLon } from "./graph";
import { TileId, tileAt, tileKey } from "./tiles";

/**
 * OSM の生データから、経路探索に使う道だけを選び、タイルに振り分ける。
 *
 * アプリと前処理スクリプトの両方から使う。同じ規則で抽出しないと、
 * Step 1 の実測値と Step 3 の生成結果が食い違ってしまう。
 */

/** 歩行者が入れない、あるいはまだ道になっていないもの。docs/design.md#13-コストモデル */
const EXCLUDED_HIGHWAY = new Set([
  "motorway",
  "trunk",
  "motorway_link",
  "trunk_link",
  "construction",
  "proposed",
]);

/** 経路探索に使う道か。 */
export function isWalkable(tags: Record<string, string>): boolean {
  const highway = tags.highway;
  if (!highway) return false;
  if (EXCLUDED_HIGHWAY.has(highway)) return false;
  if (tags.foot === "no") return false;
  if (tags.access === "private") return false;
  return true;
}

/**
 * way を入れるタイル。**構成ノードが 1 つでも入るタイルすべて**に入れる。
 *
 * こうすると隣り合うタイルが自然に重なり、境界をまたぐ way が
 * どちらのタイルからも読める（docs/design.md#23-タイル間の接続）。
 * 片側にしか無いノードを参照する形になるので、読み出し側は
 * way が指す node をタイルに関係なく集めること。
 */
export function tilesForNodes(coords: LatLon[]): TileId[] {
  const seen = new Map<string, TileId>();
  for (const c of coords) {
    const tile = tileAt(c.lat, c.lon);
    seen.set(tileKey(tile), tile);
  }
  return [...seen.values()];
}
