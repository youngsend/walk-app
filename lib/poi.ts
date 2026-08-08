import { LatLon, distanceMeters } from "./graph";

/**
 * 地図上の地点（店・駅・公園など）の名前。
 * docs/requirements.md#f-4-散歩ルートの提案
 *
 * **Apple Maps からは名前を取れない**（`onPoiClick` は Google Maps 限定）ので、
 * OSM の名前つき地点を DB に持ち、タップ地点の最寄りを引く。通信は不要。
 */

/** タップ地点から何 m 以内なら「そこを指した」とみなすか。 */
export const POI_MAX_METERS = 60;

export type Poi = {
  name: string;
  /** amenity / shop / leisure など。OSM のどのタグ由来か */
  kind: string;
  lat: number;
  lon: number;
};

export type NearbyPoi = Poi & { distanceM: number };

/**
 * タップ地点に最も近い地点。遠すぎれば返さない。
 *
 * ズームアウトして何も無い場所をタップしたときに遠くの店名を出すと、
 * かえって誤解を招く。
 */
/** 町名を探す距離。代表点が 1 つ置かれているだけなので広く取る。 */
export const PLACE_MAX_METERS = 600;

/** OSM の `place` タグ由来。町丁名（「中延二丁目」など） */
const PLACE_KIND = "place";

/**
 * タップした場所を言葉にする。
 *
 * 近くに店や公園があればその名前、無ければ町名。
 * **店のほうが具体的なので優先する。** 町名は代表点に 1 つ置かれている
 * だけなので、見つける距離を広く取っている。
 */
export function describePoint(pois: Poi[], point: LatLon): NearbyPoi | undefined {
  const spots = pois.filter((p) => p.kind !== PLACE_KIND);
  const found = nearestPoi(spots, point);
  if (found) return found;

  const places = pois.filter((p) => p.kind === PLACE_KIND);
  return nearestPoi(places, point, PLACE_MAX_METERS);
}

export function nearestPoi(
  pois: Poi[],
  point: LatLon,
  maxMeters = POI_MAX_METERS,
): NearbyPoi | undefined {
  let best: NearbyPoi | undefined;
  for (const poi of pois) {
    const distanceM = distanceMeters(point, poi);
    if (distanceM > maxMeters) continue;
    if (!best || distanceM < best.distanceM) best = { ...poi, distanceM };
  }
  return best;
}
