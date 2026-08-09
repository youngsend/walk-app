import { POI_MAX_METERS, Poi, describePoint, isAreaWay, nearestPoi } from "@/lib/poi";

/** 武蔵小山あたり。緯度 0.0001 度 ≒ 11m */
const BASE = { lat: 35.62, lon: 139.7 };
const poi = (name: string, dLat: number, dLon = 0, kind = "shop"): Poi => ({
  name,
  kind,
  lat: BASE.lat + dLat,
  lon: BASE.lon + dLon,
});

describe("nearestPoi", () => {
  it("一番近い地点を返す", () => {
    const pois = [poi("遠い店", 0.001), poi("近い店", 0.0001)];
    expect(nearestPoi(pois, BASE)?.name).toBe("近い店");
  });

  it("離れすぎていれば返さない", () => {
    // 地図をズームアウトして何も無い場所をタップした場合。
    // 遠くの店の名前を出すと、かえって誤解を招く
    expect(nearestPoi([poi("遠い店", 0.01)], BASE)).toBeUndefined();
  });

  it("しきい値の内と外で切り替わる", () => {
    const inside = (POI_MAX_METERS * 0.8) / 111320;
    const outside = (POI_MAX_METERS * 1.2) / 111320;
    expect(nearestPoi([poi("内", inside)], BASE)?.name).toBe("内");
    expect(nearestPoi([poi("外", outside)], BASE)).toBeUndefined();
  });

  it("何も無ければ返さない", () => {
    expect(nearestPoi([], BASE)).toBeUndefined();
  });

  it("距離を一緒に返す", () => {
    // 「そこそこ近い」のか「すぐそこ」なのかを画面で出し分けられる
    const found = nearestPoi([poi("店", 0.0001)], BASE);
    expect(found?.distanceM).toBeGreaterThan(10);
    expect(found?.distanceM).toBeLessThan(12);
  });

  it("種別も返す", () => {
    expect(nearestPoi([poi("公園", 0.0001, 0, "leisure")], BASE)?.kind).toBe("leisure");
  });
});

describe("describePoint", () => {
  const shop = poi("セブンイレブン", 0.0002);
  const area = { ...poi("中延二丁目", 0.002), kind: "place" };

  /** 面。重心と、その広がり */
  const park = (name: string, dLat: number, halfDeg: number): Poi => ({
    name,
    kind: "leisure",
    lat: BASE.lat + dLat,
    lon: BASE.lon,
    bounds: {
      south: BASE.lat + dLat - halfDeg,
      north: BASE.lat + dLat + halfDeg,
      west: BASE.lon - halfDeg,
      east: BASE.lon + halfDeg,
    },
  });

  it("近くに地点があればその名前を返す", () => {
    expect(describePoint([shop, area], BASE)?.name).toBe("セブンイレブン");
  });

  it("地点が無ければ町名で答える", () => {
    // 店も公園も無い場所をタップした場合。座標だけよりは分かる
    const found = describePoint([area], BASE);
    expect(found?.name).toBe("中延二丁目");
    expect(found?.kind).toBe("place");
  });

  it("町名は遠くても拾う", () => {
    // 町名は代表点に 1 つ置かれているだけなので、地点より広く探す
    const far = { ...poi("中延二丁目", 0.003), kind: "place" };
    expect(describePoint([far], BASE)?.name).toBe("中延二丁目");
  });

  it("町名より近くの地点を優先する", () => {
    // 町名の代表点がたまたま near にあっても、店のほうが具体的
    const near = { ...poi("中延二丁目", 0.0001), kind: "place" };
    expect(describePoint([shop, near], BASE)?.name).toBe("セブンイレブン");
  });

  it("どちらも遠ければ返さない", () => {
    expect(describePoint([poi("遠い店", 0.05)], BASE)).toBeUndefined();
  });

  it("何も無ければ返さない", () => {
    expect(describePoint([], BASE)).toBeUndefined();
  });

  it("面の中にいれば、重心から遠くてもその面を返す", () => {
    // **回帰テスト。** 公園を重心 1 点に潰していたため、公園の中を
    // タップしても中心から離れると別の店の名前が出ていた。
    // 散歩の目的地として公園は一番ありそうなので、これでは困る
    const big = park("林試の森公園", 0.002, 0.003);
    expect(describePoint([big], BASE)?.name).toBe("林試の森公園");
  });

  it("面の中では、近くの小さな地点より面を優先する", () => {
    // 公園の中にある自販機やベンチの名前を出しても仕方がない
    const big = park("林試の森公園", 0.002, 0.003);
    expect(describePoint([big, poi("自販機", 0.0001)], BASE)?.name).toBe("林試の森公園");
  });

  it("重なっていれば小さい面を返す", () => {
    // 広い公園の中の小さな庭園など。具体的なほうが役に立つ
    const big = park("大きな公園", 0, 0.01);
    const small = park("小さな庭園", 0, 0.001);
    expect(describePoint([big, small], BASE)?.name).toBe("小さな庭園");
  });

  it("面の外なら、その面は返さない", () => {
    const big = park("林試の森公園", 0.05, 0.003);
    expect(describePoint([big], BASE)).toBeUndefined();
  });

  it("面の中では距離 0 を返す", () => {
    const big = park("林試の森公園", 0.002, 0.003);
    expect(describePoint([big], BASE)?.distanceM).toBe(0);
  });
});

describe("isAreaWay", () => {
  it("閉じた形は面として扱う", () => {
    // 公園や敷地。最初と最後が同じノード
    expect(isAreaWay([1, 2, 3, 4, 1])).toBe(true);
  });

  it("閉じていない線は面として扱わない", () => {
    // **回帰テスト。** 鉄道路線を面として入れたら、細長い形の bbox が
    // 広大な矩形になり、住宅地をタップしても「東急目黒線」が返っていた
    expect(isAreaWay([1, 2, 3, 4])).toBe(false);
  });

  it("短すぎるものは面として扱わない", () => {
    expect(isAreaWay([1, 2, 1])).toBe(false);
    expect(isAreaWay([1, 1])).toBe(false);
    expect(isAreaWay([1])).toBe(false);
    expect(isAreaWay([])).toBe(false);
  });
});
