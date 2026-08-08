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
 * 歩行不可の道路（trunk / motorway）沿いの歩道に当てる係数。
 * 親の係数が存在しないので、通行を許す上限を当てる。
 */
const SIDEPATH_CEILING = 8.0;

/**
 * 車道に付随して別に描かれることがある、歩行者専用の道の種別。
 * これらだけが `along`（沿っている幹線）を継ぐ。
 *
 * `footway` の 39.4% は `footway=` が無く、公園の遊歩道と
 * 種別を書かれていない歩道が混ざっている。**タグでは見分けられないが、
 * 隣に幹線が走っているかは座標で分かる。** 歩道橋の橋げたもここに入る。
 */
const SIDEPATH_ELIGIBLE = new Set(["footway", "path", "pedestrian", "steps"]);

/**
 * 歩行者専用の道の係数は、**沿っている道路の係数を継ぐ。**
 *
 * 幹線に 8.0 を付けても、歩行者はその車道の way を通らない。
 * 並走して別に描かれた歩道を通る。歩道が安いままなら
 * **幹線の減点は丸ごと迂回され、意味を失う。**
 * 実測でも、歩道を 1.5 に留めた段階では経路の 39% が footway だった
 * （docs/design.md#111-footway-の-6-割は道路の付属物）。
 *
 * 沿っている道路は前処理が空間的に求めて `along` 列に入れる
 * （lib/sidepath.ts）。OSM の歩道は親道路を記録していないため。
 * `along` が無い道は生活道路沿いか判断不能なので、好きな道と同じ 1.0。
 */
function sidepathFactor(along: string): number {
  const inherited = HIGHWAY_FACTOR[along];
  if (inherited !== undefined) return inherited;
  // trunk / motorway は歩行不可で表に無い
  return SIDEPATH_CEILING;
}

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
    DEFAULT_FACTOR,
  ) * MIN_LANES_FACTOR;

/** 区間の重み。距離に掛けるとコストになる。 */
export function edgeFactor(tags: Record<string, string>): number {
  const highway = tags.highway ?? "";

  // 幹線沿いの歩行者専用道は、沿っている道路の係数を継ぐ。
  // 横断歩道は除く（横断は避けようがない）
  let base = highwayFactor(highway);
  if (
    tags.along !== undefined &&
    SIDEPATH_ELIGIBLE.has(highway) &&
    tags.footway !== "crossing"
  ) {
    base = sidepathFactor(tags.along);
  }

  return base * lanesFactor(tags.lanes);
}
