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

/** Overpass の bbox 用。south, west, north, east の順。 */
export function tileBounds(tile: TileId) {
  return {
    south: (tile.y * UNITS_PER_TILE) / SCALE,
    west: (tile.x * UNITS_PER_TILE) / SCALE,
    north: ((tile.y + 1) * UNITS_PER_TILE) / SCALE,
    east: ((tile.x + 1) * UNITS_PER_TILE) / SCALE,
  };
}
