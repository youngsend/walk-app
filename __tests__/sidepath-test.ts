import {
  ArterialIndex,
  distanceToSegmentMeters,
  SIDEPATH_MAX_METERS,
} from "@/lib/sidepath";


/** 武蔵小山あたり。緯度 0.00001 度 ≒ 1.1m、経度 0.00001 度 ≒ 0.9m */
const BASE = { lat: 35.62, lon: 139.7 };
const at = (dLat: number, dLon: number) => ({
  lat: BASE.lat + dLat,
  lon: BASE.lon + dLon,
});

describe("distanceToSegmentMeters", () => {
  it("線分の上なら 0", () => {
    const a = at(0, 0);
    const b = at(0, 0.001);
    expect(distanceToSegmentMeters(at(0, 0.0005), a, b)).toBeCloseTo(0, 1);
  });

  it("線分の横なら垂線の長さになる", () => {
    // 東西に伸びる線分の 0.0001 度（約 11m）北
    const distance = distanceToSegmentMeters(at(0.0001, 0.0005), at(0, 0), at(0, 0.001));
    expect(distance).toBeGreaterThan(10);
    expect(distance).toBeLessThan(12);
  });

  it("線分の外側では端点までの距離になる", () => {
    // 線分は東へ 0.001 度。その手前（西）にある点は端点 a が最も近い
    const a = at(0, 0);
    const point = at(0, -0.001);
    expect(distanceToSegmentMeters(point, a, at(0, 0.001))).toBeCloseTo(
      distanceToSegmentMeters(point, a, a),
      0,
    );
  });

  it("長さ 0 の線分でも落ちない", () => {
    const a = at(0, 0);
    expect(distanceToSegmentMeters(at(0.0001, 0), a, a)).toBeGreaterThan(0);
  });
});

describe("ArterialIndex", () => {
  /** 東西にまっすぐ伸びる幹線 */
  function withRoad(highway: string) {
    const index = new ArterialIndex();
    index.add(highway, [at(0, 0), at(0, 0.002)]);
    return index;
  }

  it("すぐ隣を走る幹線の種別を返す", () => {
    // 約 11m 北。歩道と車道の典型的な間隔
    expect(withRoad("primary").classNear(at(0.0001, 0.001))).toBe("primary");
  });

  it("遠く離れていれば何も返さない", () => {
    // 約 1.1km 北
    expect(withRoad("primary").classNear(at(0.01, 0.001))).toBeUndefined();
  });

  it("しきい値の内と外で切り替わる", () => {
    const index = withRoad("tertiary");
    // 緯度 1 度 ≒ 111,320m として、しきい値の 8 割と 1.2 倍を試す
    const inside = (SIDEPATH_MAX_METERS * 0.8) / 111320;
    const outside = (SIDEPATH_MAX_METERS * 1.2) / 111320;
    expect(index.classNear(at(inside, 0.001))).toBe("tertiary");
    expect(index.classNear(at(outside, 0.001))).toBeUndefined();
  });

  it("複数の幹線が近いときは格の高いほうを返す", () => {
    // 幹線沿いの歩道は、より大きな道路の性格に引きずられる
    const index = new ArterialIndex();
    index.add("tertiary", [at(0, 0), at(0, 0.002)]);
    index.add("primary", [at(0.0002, 0), at(0.0002, 0.002)]);
    expect(index.classNear(at(0.0001, 0.001))).toBe("primary");
  });

  it("接続路は接続元の種別として扱う", () => {
    expect(withRoad("primary_link").classNear(at(0.0001, 0.001))).toBe("primary");
  });

  it("幹線でない種別は登録しない", () => {
    // residential の隣の歩道は減点しない。これが 8% の取りこぼしへの対処
    expect(withRoad("residential").classNear(at(0.0001, 0.001))).toBeUndefined();
    expect(withRoad("unclassified").classNear(at(0.0001, 0.001))).toBeUndefined();
  });

  it("歩行不可の幹線も登録する", () => {
    // trunk は歩行不可で DB に入らないが、その歩道は歩ける。
    // 実測では別線歩道の付与率が最も高い（7.0%）
    expect(withRoad("trunk").classNear(at(0.0001, 0.001))).toBe("trunk");
    expect(withRoad("motorway").classNear(at(0.0001, 0.001))).toBe("motorway");
  });

  it("折れ曲がった幹線でも、どの区間の近くでも見つかる", () => {
    const index = new ArterialIndex();
    index.add("secondary", [at(0, 0), at(0, 0.002), at(0.002, 0.002)]);
    expect(index.classNear(at(0.0001, 0.001))).toBe("secondary");
    expect(index.classNear(at(0.001, 0.0021))).toBe("secondary");
  });

  it("セルの境目をまたいでも見つかる", () => {
    // 格子で当たりを付けるため、境目の取りこぼしが起きやすい。
    // 幹線を少しずつ動かして、常に見つかることを確かめる
    for (let i = 0; i < 60; i++) {
      const shift = i * 0.0007;
      const index = new ArterialIndex();
      index.add("primary", [at(shift, shift), at(shift, shift + 0.002)]);
      expect(index.classNear(at(shift + 0.0001, shift + 0.001))).toBe("primary");
    }
  });

  it("何も登録していなければ何も返さない", () => {
    expect(new ArterialIndex().classNear(at(0, 0))).toBeUndefined();
  });

  it("ノードが 1 つの way は無視する", () => {
    const index = new ArterialIndex();
    index.add("primary", [at(0, 0)]);
    expect(index.classNear(at(0, 0))).toBeUndefined();
  });
});

describe("ArterialIndex.classAlong", () => {
  /** 東西にまっすぐ伸びる幹線を 1 本持つ index */
  function withRoad(highway = "primary") {
    const index = new ArterialIndex();
    // 東西 0.01 度（約 900m）
    index.add(highway, [at(0, 0), at(0, 0.01)]);
    return index;
  }

  it("幹線に並走する道は、その幹線を返す", () => {
    // 幹線の 11m 北を、同じ向きに 900m 走る
    const along = [at(0.0001, 0), at(0.0001, 0.01)];
    expect(withRoad().classAlong(along)).toBe("primary");
  });

  it("幹線を横切るだけの道は返さない", () => {
    // **歩道橋や連絡通路がこれ。** 幹線の上を south→north に横断する。
    // 全長 220m のうち幹線に近いのは一部だけ
    const across = [at(-0.001, 0.005), at(0.001, 0.005)];
    expect(withRoad().classAlong(across)).toBeUndefined();
  });

  it("一部だけ並走する道は返さない", () => {
    // 前半は幹線沿い、後半は大きく離れる
    const partly = [at(0.0001, 0), at(0.0001, 0.002), at(0.01, 0.002)];
    expect(withRoad().classAlong(partly)).toBeUndefined();
  });

  it("ノードが粗くても長さで判断する", () => {
    // ノードは 2 つだけだが、間を刻んで近さを測るので並走と分かる
    const along = [at(0.0001, 0), at(0.0001, 0.01)];
    expect(withRoad().classAlong(along)).toBe("primary");
  });

  it("幹線から離れていれば返さない", () => {
    const far = [at(0.01, 0), at(0.01, 0.01)];
    expect(withRoad().classAlong(far)).toBeUndefined();
  });

  it("並走する幹線が複数あれば格の高いほうを返す", () => {
    const index = new ArterialIndex();
    index.add("tertiary", [at(0, 0), at(0, 0.01)]);
    index.add("primary", [at(0.0002, 0), at(0.0002, 0.01)]);
    expect(index.classAlong([at(0.0001, 0), at(0.0001, 0.01)])).toBe("primary");
  });

  it("ノードが 1 つなら返さない", () => {
    expect(withRoad().classAlong([at(0.0001, 0)])).toBeUndefined();
  });

  it("空なら返さない", () => {
    expect(withRoad().classAlong([])).toBeUndefined();
  });
});
