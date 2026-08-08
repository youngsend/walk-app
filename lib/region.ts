/**
 * 地図の表示範囲。react-native-maps の Region と同じ形。
 *
 * delta は「端から端までの度数」で、半径ではない。
 */
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** 緯度 1 度あたりの距離（メートル）。経度によらずほぼ一定。 */
const METERS_PER_DEGREE_LAT = 111_320;

/**
 * ある地点を中心に、指定した半径がおおよそ収まる範囲を返す。
 *
 * 経線は極に近づくほど間隔が狭まるので、同じ距離でも高緯度ほど
 * 度数を大きく取る必要がある。
 */
export function regionAround(lat: number, lon: number, radiusMeters: number): Region {
  const latitudeDelta = (radiusMeters * 2) / METERS_PER_DEGREE_LAT;
  // 極付近で 0 除算にならないよう下限を置く
  const shrink = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return {
    latitude: lat,
    longitude: lon,
    latitudeDelta,
    longitudeDelta: latitudeDelta / shrink,
  };
}
