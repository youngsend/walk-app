/**
 * 種別係数。コストは `距離 × 種別係数 × 履歴係数`。
 * docs/design.md#13-コストモデル
 *
 * 値は初期値で、実際に歩いて調整する（docs/requirements.md#7-未決事項）。
 * 調整しやすいようここ 1 箇所にまとめてある。
 */
/**
 * 歩いていて気持ちのいい道。**どれも同じ係数にしてある。**
 *
 * 以前は 0.8〜1.5 に散らしていたが、作者がどれも同じくらい好きなので
 * 差を付ける根拠が無かった（階段も含む）。揃えた利点が 2 つある。
 * - 好きな道どうしでは距離だけで決まる。無駄な遠回りをしない
 * - 係数の下限が上がり、A\* の推定値が締まって探索が速くなる（MIN_EDGE_FACTOR）
 *
 * 幹線を避けるという目的には影響しない。tertiary 以上は据え置き。
 */
const LIKED = 1.0;

const HIGHWAY_FACTOR: Record<string, number> = {
  pedestrian: LIKED,
  footway: LIKED,
  path: LIKED,
  living_street: LIKED,
  residential: LIKED,
  unclassified: LIKED,
  service: LIKED,
  steps: LIKED,
  // ここから幹線道路
  tertiary: 2.0,
  secondary: 4.0,
  primary: 8.0,
};

/**
 * 表に無い種別の既定値。residential と同じ扱いにする。
 * 実データには cycleway・rest_area・corridor などが少数含まれ、
 * 設計時の表では網羅できていない。
 */
const DEFAULT_FACTOR = 1.0;

export function highwayFactor(highway: string): number {
  const direct = HIGHWAY_FACTOR[highway];
  if (direct !== undefined) return direct;

  // primary_link などの接続路は、接続元と同じ重みで扱う
  if (highway.endsWith("_link")) {
    const base = HIGHWAY_FACTOR[highway.slice(0, -"_link".length)];
    if (base !== undefined) return base;
  }
  return DEFAULT_FACTOR;
}

/**
 * `footway=` の種別ごとの係数。**`highway=footway` のときだけ見る。**
 *
 * 関東全域の実測では `highway=footway` 407,776 本のうち
 * 歩道 30.3% / 横断歩道 29.8% で、6 割が車道に付随して別に描かれた線だった
 * （docs/design.md#111-footway-の-6-割は道路の付属物）。
 * これを 0.8 で優遇すると**大通り沿いの歩道が最も安い道になり**、
 * 経路の統計に primary が出てこないまま幹線沿いを歩くことになる。
 *
 * 歩道を 1.5 にしたのは、日本では歩道が別に描かれる道路がおおむね
 * tertiary 以上だからで、「幹線沿いの proxy」として基準より不利にしてある。
 * 値は初期値。実際に歩いて調整する（docs/requirements.md#7-未決事項）。
 */
const FOOTWAY_FACTOR: Record<string, number> = {
  sidewalk: 1.5,
  // 横断は避けようがない。優遇だけ外して好きな道と同じにする
  crossing: LIKED,
};

/** 車線補正の下限。1 車線以下の道に掛かる。 */
const MIN_LANES_FACTOR = 0.9;

/**
 * lanes による補正。タグがある場合のみ適用する。
 * 日本の生活道路にはほぼ付いていないため、あくまで補助
 * （docs/design.md#11-前提調査-lanes-タグは使えない）。
 */
export function lanesFactor(lanes: string | undefined): number {
  if (lanes === undefined) return 1.0;
  // "2;3" や "1.5" のような値もあるため、先頭の数値だけ見る
  const n = parseFloat(lanes);
  if (!Number.isFinite(n)) return 1.0;
  if (n >= 2) return 1.5;
  if (n <= 1) return MIN_LANES_FACTOR;
  return 1.0;
}

/**
 * どの区間もこれより安くならない、という下限。
 *
 * `route.ts` の A\* が直線距離に掛けて推定値にする。**実際の係数より
 * 大きいと推定値が実コストを超え、最短性が壊れる。**
 * 以前は route.ts に 0.8 を直書きしていたが、車線補正 0.9 が掛かると
 * 0.72 まで下がる区間が実データに 195 本あった。
 * 表から導いておけば、係数をいじっても食い違わない。
 */
export const MIN_EDGE_FACTOR =
  Math.min(
    ...Object.values(HIGHWAY_FACTOR),
    ...Object.values(FOOTWAY_FACTOR),
    DEFAULT_FACTOR,
  ) * MIN_LANES_FACTOR;

/** 区間の重み。距離に掛けるとコストになる。 */
export function edgeFactor(tags: Record<string, string>): number {
  const highway = tags.highway ?? "";

  // footway だけは種別まで見る。知らない種別なら歩行者専用道のまま優遇する
  let base = highwayFactor(highway);
  if (highway === "footway" && tags.footway !== undefined) {
    base = FOOTWAY_FACTOR[tags.footway] ?? base;
  }

  return base * lanesFactor(tags.lanes);
}
