import { LatLon, distanceMeters } from "./graph";

/**
 * 歩道（`footway=sidewalk`）が、どの格の道路に沿っているかを空間的に求める。
 *
 * **OSM の歩道は親道路を記録していない。** 関東全域の実測で
 * `is_sidepath` は 0 件、`name` も 0.4% しか付いていなかった。
 * タグから辿れないので、隣に何が走っているかを座標で調べるしかない。
 *
 * これがあると「幹線沿いの歩道だけを減点し、生活道路の歩道は減点しない」が
 * できる（docs/design.md#sidewalk-は本当に幹線の歩道か実測 の 8% の取りこぼし）。
 *
 * 前処理（Mac・年 1 回）でだけ使う。端末では結果の列を読むだけ。
 */

/** 歩道が親道路の中心線から離れていてよい距離。 */
export const SIDEPATH_MAX_METERS = 25;

/**
 * 「幹線沿い」と認めるのに必要な、幹線の近くを通る長さの割合。
 *
 * 1 点だけで判定すると**幹線を横切る道**（歩道橋・連絡通路）まで
 * 幹線沿いになってしまう。並走する歩道はほぼ全長が近いので、
 * 高めに取って横断と区別する。
 */
export const SIDEPATH_MIN_COVERAGE = 0.7;

/** 近さを測るために道を刻む間隔。ノードの間隔がまちまちなので長さで刻む。 */
const SAMPLE_METERS = 10;

/** 沿っていることを減点したい道路の格。歩行不可の trunk / motorway も含む。 */
const ARTERIAL = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);

/**
 * 格子の一辺（度）。しきい値より大きく取り、周囲 1 セルまで見れば
 * 取りこぼしが出ないようにする。緯度 0.0005 度 ≒ 55m。
 */
const CELL = 0.0005;

/** 点と線分の距離。線分の外側にはみ出したら端点までの距離。 */
export function distanceToSegmentMeters(point: LatLon, a: LatLon, b: LatLon): number {
  // 経度は緯度によって縮むので、緯度に合わせて引き伸ばしてから内積を取る
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lon * scale;
  const ay = a.lat;
  const bx = b.lon * scale;
  const by = b.lat;
  const px = point.lon * scale;
  const py = point.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }

  const nearest = { lat: ay + t * dy, lon: (ax + t * dx) / scale };
  return distanceMeters(point, nearest);
}

/** 格の高さ。近くに複数あれば高いほうを採る。 */
const RANK: Record<string, number> = {
  tertiary: 1,
  secondary: 2,
  primary: 3,
  trunk: 4,
  motorway: 5,
};

type Segment = { a: LatLon; b: LatLon; highway: string };

/**
 * 幹線の線分を格子に入れて、ある点の近くを走る幹線を引けるようにする。
 *
 * 総当たりだと関東全域で 100 万本超 × 歩道 12 万本になり終わらない。
 */
export class ArterialIndex {
  private cells = new Map<string, Segment[]>();

  /** way を 1 本加える。幹線でなければ何もしない。 */
  add(highway: string, coords: LatLon[]): void {
    const base = highway.endsWith("_link")
      ? highway.slice(0, -"_link".length)
      : highway;
    if (!ARTERIAL.has(base)) return;

    for (let i = 0; i + 1 < coords.length; i++) {
      const segment: Segment = { a: coords[i], b: coords[i + 1], highway: base };
      // 線分が跨るセルすべてに入れる。端点だけだと長い線分が抜ける
      for (const key of cellsSpanning(coords[i], coords[i + 1])) {
        const list = this.cells.get(key);
        if (list) list.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  /**
   * 点の近くを走る幹線の種別。無ければ undefined。
   * 複数あれば格の高いほうを返す。
   */
  classNear(point: LatLon, maxMeters = SIDEPATH_MAX_METERS): string | undefined {
    const cx = Math.floor(point.lon / CELL);
    const cy = Math.floor(point.lat / CELL);

    let best: string | undefined;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(`${cx + dx}/${cy + dy}`);
        if (!list) continue;
        for (const segment of list) {
          if (best !== undefined && RANK[segment.highway] <= RANK[best]) continue;
          if (distanceToSegmentMeters(point, segment.a, segment.b) <= maxMeters) {
            best = segment.highway;
          }
        }
      }
    }
    return best;
  }

  /**
   * 道の**全長のうちどれだけが幹線の近くを通るか**で判定し、
   * 幹線沿いと言えるならその種別を返す。
   *
   * `classNear` を 1 点だけに当てると、**幹線を横切る道**（歩道橋・連絡通路）が
   * 「幹線沿い」と誤判定される。沿って歩くのと横切るのは別物なので、
   * 近い区間の割合を見る。並走する歩道はほぼ全長が近く、横切る道は一部だけ。
   *
   * ノードの間隔はまちまちなので、**一定間隔に刻んでから**数える。
   */
  classAlong(
    coords: LatLon[],
    maxMeters = SIDEPATH_MAX_METERS,
    minCoverage = SIDEPATH_MIN_COVERAGE,
  ): string | undefined {
    if (coords.length < 2) return undefined;

    let total = 0;
    let near = 0;
    let best: string | undefined;

    for (let i = 0; i + 1 < coords.length; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const length = distanceMeters(a, b);
      if (length === 0) continue;

      // 端点だけでは足りない。SAMPLE_METERS ごとに刻む
      const steps = Math.max(1, Math.ceil(length / SAMPLE_METERS));
      for (let step = 0; step < steps; step++) {
        const t = (step + 0.5) / steps;
        const point = {
          lat: a.lat + (b.lat - a.lat) * t,
          lon: a.lon + (b.lon - a.lon) * t,
        };
        const piece = length / steps;
        total += piece;

        const found = this.classNear(point, maxMeters);
        if (found) {
          near += piece;
          if (!best || RANK[found] > RANK[best]) best = found;
        }
      }
    }

    if (total === 0 || best === undefined) return undefined;
    return near / total >= minCoverage ? best : undefined;
  }

  get size(): number {
    return this.cells.size;
  }
}

/** 線分が通るセルの key。斜めの線分でも間を飛ばさないよう、両端の矩形を埋める。 */
function cellsSpanning(a: LatLon, b: LatLon): string[] {
  const x1 = Math.floor(Math.min(a.lon, b.lon) / CELL);
  const x2 = Math.floor(Math.max(a.lon, b.lon) / CELL);
  const y1 = Math.floor(Math.min(a.lat, b.lat) / CELL);
  const y2 = Math.floor(Math.max(a.lat, b.lat) / CELL);

  const keys: string[] = [];
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) keys.push(`${x}/${y}`);
  }
  return keys;
}
