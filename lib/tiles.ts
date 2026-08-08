import { LatLon, distanceMeters } from "./graph";

/**
 * タイルは緯度・経度 0.02 度の固定グリッド。
 * 東京付近で約 2.2km × 1.8km（約 4.0 km²）。
 * docs/design.md#21-タイルの定義
 */
export const TILE_SIZE = 0.02;

/**
 * 座標を整数に直してから割る。度のまま `lon / 0.02` とすると
 * 139.70 / 0.02 が 6984.999999999999 になり、境界の座標が隣のタイルに落ちる。
 * SCALE は OSM の座標精度（小数 7 桁）。
 */
const SCALE = 1e7;
const UNITS_PER_TILE = Math.round(TILE_SIZE * SCALE); // 200000

export type TileId = { x: number; y: number };

/** 座標を含むタイル。x が経度方向、y が緯度方向。 */
export function tileAt(lat: number, lon: number): TileId {
  return {
    x: Math.floor(Math.round(lon * SCALE) / UNITS_PER_TILE),
    y: Math.floor(Math.round(lat * SCALE) / UNITS_PER_TILE),
  };
}

/** DB のキーや Set の要素に使う文字列表現。 */
export function tileKey(tile: TileId): string {
  return `${tile.x}/${tile.y}`;
}

export function parseTileKey(key: string): TileId {
  const [x, y] = key.split("/").map(Number);
  return { x, y };
}

/**
 * 中心タイルとその周囲。半径 1 なら 3×3 の 9 枚。
 *
 * 関東全域を入れると保存済みタイルは 8,000 枚を超える。
 * 全部まとめて読むとメモリに載らないので、読む範囲は常にここで絞る。
 */
export function tilesAround(center: TileId, radius: number): TileId[] {
  const tiles: TileId[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      tiles.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return tiles;
}

/**
 * 経路が通りうるタイル。**楕円**で切り出す。
 *
 * 矩形で囲うと、経路が絶対に通らない隅まで読んでしまう。
 * 直線 9.7km の実測で 42 枚 = 168km² になり、way 94,774 本 /
 * node 308,702 個の読み込みに約 6 秒かかっていた。
 *
 * **なぜ楕円か。** 総距離が L 以下の経路上の任意の点 p は
 * `d(出発, p) + d(p, 目的) <= L` を満たす。逆に言えば、この和が L を超える点を
 * 通る経路は必ず L より長い。つまり**「直線の N 倍以内の経路」が通りうる範囲は、
 * 焦点を出発地と目的地に置いた楕円ちょうど**で、取りこぼしが出ない。
 *
 * `detourFactor` は許す遠回りの倍率。実測の経路は直線の 1.37 倍だった。
 */
export function tilesForRoute(
  from: LatLon,
  to: LatLon,
  detourFactor = ROUTE_DETOUR_FACTOR,
): TileId[] {
  const straight = distanceMeters(from, to);
  const budget = Math.max(straight * detourFactor, MIN_ROUTE_BUDGET_M);

  const a = tileAt(from.lat, from.lon);
  const b = tileAt(to.lat, to.lon);

  const tiles: TileId[] = [];
  // 楕円は必ずこの矩形に収まる。その中だけを調べる
  const reach = Math.ceil(budget / metersPerTileLat()) + 1;
  for (let y = Math.min(a.y, b.y) - reach; y <= Math.max(a.y, b.y) + reach; y++) {
    for (let x = Math.min(a.x, b.x) - reach; x <= Math.max(a.x, b.x) + reach; x++) {
      if (closestSum({ x, y }, from, to) <= budget) tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * タイルの中で `d(from, p) + d(p, to)` が最も小さい点の値。
 *
 * 四隅と中心で代表させる。厳密な最小ではないが、`detourFactor` に
 * 実測（1.37 倍）より余裕を持たせてあるので、この粗さは吸収される。
 */
function closestSum(tile: TileId, from: LatLon, to: LatLon): number {
  const b = tileBounds(tile);
  const points: LatLon[] = [
    { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 },
    { lat: b.south, lon: b.west },
    { lat: b.south, lon: b.east },
    { lat: b.north, lon: b.west },
    { lat: b.north, lon: b.east },
  ];
  let best = Infinity;
  for (const p of points) {
    const sum = distanceMeters(from, p) + distanceMeters(p, to);
    if (sum < best) best = sum;
  }
  return best;
}

/**
 * 許す遠回りの倍率。これを超える経路は探索範囲から外れる。
 *
 * 実測した経路の直線比は 0.74km で 1.34 倍、2.91km で 1.38 倍、
 * 5.26km で 1.41 倍、9.71km で 1.37 倍。1.45 はその少し上に置いてある。
 * 下げるほど読む量は減るが、**良い迂回路を範囲外に落とす**。
 */
export const ROUTE_DETOUR_FACTOR = 1.45;

/** 近すぎる 2 点でも、周囲を最低限読むための下限。 */
const MIN_ROUTE_BUDGET_M = 1500;

function metersPerTileLat(): number {
  return (TILE_SIZE * Math.PI * 6371008.8) / 180;
}

/** タイルの範囲。south, west, north, east の順。 */
export function tileBounds(tile: TileId) {
  return {
    south: (tile.y * UNITS_PER_TILE) / SCALE,
    west: (tile.x * UNITS_PER_TILE) / SCALE,
    north: ((tile.y + 1) * UNITS_PER_TILE) / SCALE,
    east: ((tile.x + 1) * UNITS_PER_TILE) / SCALE,
  };
}
