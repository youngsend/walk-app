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
  return highwayFactor(tags.highway ?? "") * lanesFactor(tags.lanes);
}
