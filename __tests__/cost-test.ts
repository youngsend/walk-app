import { edgeFactor, highwayFactor, lanesFactor } from "@/lib/cost";

describe("highwayFactor", () => {
  it("設計表の値を返す", () => {
    // docs/design.md#13-コストモデル
    expect(highwayFactor("footway")).toBe(0.8);
    expect(highwayFactor("pedestrian")).toBe(0.8);
    expect(highwayFactor("path")).toBe(0.8);
    expect(highwayFactor("living_street")).toBe(0.9);
    expect(highwayFactor("residential")).toBe(1.0);
    expect(highwayFactor("unclassified")).toBe(1.0);
    expect(highwayFactor("service")).toBe(1.2);
    expect(highwayFactor("steps")).toBe(1.5);
    expect(highwayFactor("tertiary")).toBe(2.0);
    expect(highwayFactor("secondary")).toBe(4.0);
    expect(highwayFactor("primary")).toBe(8.0);
  });

  it("歩行者専用道が生活道路より安く、幹線が高い", () => {
    expect(highwayFactor("footway")).toBeLessThan(highwayFactor("residential"));
    expect(highwayFactor("residential")).toBeLessThan(highwayFactor("tertiary"));
    expect(highwayFactor("tertiary")).toBeLessThan(highwayFactor("secondary"));
    expect(highwayFactor("secondary")).toBeLessThan(highwayFactor("primary"));
  });

  it("接続路は接続元と同じ係数になる", () => {
    expect(highwayFactor("primary_link")).toBe(highwayFactor("primary"));
    expect(highwayFactor("secondary_link")).toBe(highwayFactor("secondary"));
    expect(highwayFactor("tertiary_link")).toBe(highwayFactor("tertiary"));
  });

  it("表に無い種別は 1.0 になる", () => {
    // 実データに少数含まれる。docs/design.md#13-コストモデル
    expect(highwayFactor("cycleway")).toBe(1.0);
    expect(highwayFactor("rest_area")).toBe(1.0);
    expect(highwayFactor("corridor")).toBe(1.0);
    expect(highwayFactor("")).toBe(1.0);
    expect(highwayFactor("何か知らない値")).toBe(1.0);
  });

  it("接続元も未知なら 1.0 に落ちる", () => {
    expect(highwayFactor("unknown_link")).toBe(1.0);
  });
});

describe("lanesFactor", () => {
  it("タグが無ければ補正しない", () => {
    expect(lanesFactor(undefined)).toBe(1.0);
  });

  it("2 車線以上は 1.5 倍", () => {
    expect(lanesFactor("2")).toBe(1.5);
    expect(lanesFactor("4")).toBe(1.5);
  });

  it("1 車線以下は 0.9 倍", () => {
    expect(lanesFactor("1")).toBe(0.9);
    expect(lanesFactor("0")).toBe(0.9);
  });

  it("解釈できない値では補正しない", () => {
    expect(lanesFactor("")).toBe(1.0);
    expect(lanesFactor("unknown")).toBe(1.0);
  });

  it("複数値や小数でも先頭の数値で判断する", () => {
    expect(lanesFactor("2;3")).toBe(1.5);
    expect(lanesFactor("1.5")).toBe(1.0);
  });
});

describe("edgeFactor", () => {
  it("種別係数と車線補正を掛け合わせる", () => {
    // 実データでは primary の大半がこの 12.0 になる
    expect(edgeFactor({ highway: "primary", lanes: "2" })).toBeCloseTo(12.0);
    expect(edgeFactor({ highway: "tertiary", lanes: "2" })).toBeCloseTo(3.0);
    expect(edgeFactor({ highway: "unclassified", lanes: "1" })).toBeCloseTo(0.9);
  });

  it("車線タグが無ければ種別係数そのまま", () => {
    expect(edgeFactor({ highway: "residential" })).toBe(1.0);
    expect(edgeFactor({ highway: "footway" })).toBe(0.8);
  });

  it("highway が無くても落ちない", () => {
    expect(edgeFactor({})).toBe(1.0);
  });
});

describe("edgeFactor — footway の種別", () => {
  // 関東全域の実測で highway=footway の 6 割が歩道と横断歩道だった
  // （docs/design.md#111-footway-の-6-割は道路の付属物未解決）。
  // 車道に付随する線を 0.8 で優遇すると、大通り沿いの歩道が
  // 最も安い道になり「幹線を避ける」が骨抜きになる
  it("歩道は優遇しない", () => {
    expect(edgeFactor({ highway: "footway", footway: "sidewalk" })).toBe(1.5);
  });

  it("横断歩道は基準と同じにする", () => {
    // 横断は避けようがない。優遇だけ外す
    expect(edgeFactor({ highway: "footway", footway: "crossing" })).toBe(1.0);
  });

  it("種別の無い footway は歩行者専用道として優遇する", () => {
    expect(edgeFactor({ highway: "footway" })).toBe(0.8);
  });

  it("知らない footway 種別なら優遇したままにする", () => {
    // access_aisle や traffic_island など。歩道と決めつけない
    expect(edgeFactor({ highway: "footway", footway: "traffic_island" })).toBe(0.8);
  });

  it("footway 以外の種別では footway タグを見ない", () => {
    // 実データには highway=path に footway=sidewalk が付いた例がある
    expect(edgeFactor({ highway: "path", footway: "sidewalk" })).toBe(0.8);
    expect(edgeFactor({ highway: "primary", footway: "sidewalk" })).toBe(8.0);
  });

  it("歩道でも車線補正は掛かる", () => {
    expect(edgeFactor({ highway: "footway", footway: "sidewalk", lanes: "2" })).toBe(
      1.5 * 1.5,
    );
  });
});
