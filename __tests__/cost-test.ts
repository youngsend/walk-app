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
