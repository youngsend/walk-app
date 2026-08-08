/**
 * 種別係数。コストは `距離 × 種別係数 × 履歴係数`。
 * docs/design.md#13-コストモデル
 *
 * 値は初期値で、実際に歩いて調整する（docs/requirements.md#7-未決事項）。
 * 調整しやすいようここ 1 箇所にまとめてある。
 */
const HIGHWAY_FACTOR: Record<string, number> = {
  pedestrian: 0.8,
  footway: 0.8,
  path: 0.8,
  living_street: 0.9,
  residential: 1.0,
  unclassified: 1.0,
  service: 1.2,
  steps: 1.5,
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
 * （docs/design.md#111-footway-の-6-割は道路の付属物未解決）。
 * これを 0.8 で優遇すると**大通り沿いの歩道が最も安い道になり**、
 * 経路の統計に primary が出てこないまま幹線沿いを歩くことになる。
 *
 * 歩道を 1.5 にしたのは、日本では歩道が別に描かれる道路がおおむね
 * tertiary 以上だからで、「幹線沿いの proxy」として基準より不利にしてある。
 * 値は初期値。実際に歩いて調整する（docs/requirements.md#7-未決事項）。
 */
const FOOTWAY_FACTOR: Record<string, number> = {
  sidewalk: 1.5,
  crossing: 1.0,
};

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
  if (n <= 1) return 0.9;
  return 1.0;
}

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
