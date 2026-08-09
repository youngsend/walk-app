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
  /** 面なら重心 */
  lat: number;
  lon: number;
  /** 面の広がり。点なら無い */
  bounds?: { south: number; north: number; west: number; east: number };
};

export type NearbyPoi = Poi & { distanceM: number };

/**
 * タップ地点に最も近い地点。遠すぎれば返さない。
 *
 * ズームアウトして何も無い場所をタップしたときに遠くの店名を出すと、
 * かえって誤解を招く。
 */
/**
 * 面として扱ってよい way か。**閉じた形だけ。**
 *
 * 鉄道路線や川は細長い線で、その bbox は広大な矩形になる。面として
 * 入れると、離れた住宅地をタップしても「その中にいる」と判定されて
 * 路線名が返ってしまう（実際に「東急目黒線」が出た）。
 */
export function isAreaWay(refs: number[]): boolean {
  // 三角形以上（同じノードで閉じるので 4 点以上必要）
  if (refs.length < 4) return false;
  return refs[0] === refs[refs.length - 1];
}

/** 町名を探す距離。代表点が 1 つ置かれているだけなので広く取る。 */
export const PLACE_MAX_METERS = 600;

/** OSM の `place` タグ由来。町丁名（「中延二丁目」など） */
const PLACE_KIND = "place";

/**
 * タップした場所を言葉にする。順に試す。
 *
 * 1. **その中にいる面**（公園など）。重なっていれば小さいほうが具体的
 * 2. 近くの地点（店・駅など）
 * 3. 町名。代表点が 1 つ置かれているだけなので広く探す
 *
 * **面を先に見るのが肝。** 重心までの距離で選ぶと、公園の中をタップしても
 * 中心から離れた途端に、近くの自販機や別の店の名前が出てしまう。
 */
export function describePoint(pois: Poi[], point: LatLon): NearbyPoi | undefined {
  const containing = smallestContaining(pois, point);
  if (containing) return { ...containing, distanceM: 0 };

  const spots = pois.filter((p) => p.kind !== PLACE_KIND);
  const found = nearestPoi(spots, point);
  if (found) return found;

  const places = pois.filter((p) => p.kind === PLACE_KIND);
  return nearestPoi(places, point, PLACE_MAX_METERS);
}

/** 点を含む面のうち、最も狭いもの。 */
function smallestContaining(pois: Poi[], point: LatLon): Poi | undefined {
  let best: Poi | undefined;
  let bestArea = Infinity;
  for (const poi of pois) {
    const b = poi.bounds;
    if (!b) continue;
    if (point.lat < b.south || point.lat > b.north) continue;
    if (point.lon < b.west || point.lon > b.east) continue;

    const area = (b.north - b.south) * (b.east - b.west);
    if (area < bestArea) {
      bestArea = area;
      best = poi;
    }
  }
  return best;
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
