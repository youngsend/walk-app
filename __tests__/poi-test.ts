import { POI_MAX_METERS, Poi, describePoint, nearestPoi } from "@/lib/poi";

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
});
