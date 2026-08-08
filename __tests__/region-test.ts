import { regionAround } from "@/lib/region";

describe("regionAround", () => {
  const TOKYO = { lat: 35.62, lon: 139.7 };

  it("中心をそのまま返す", () => {
    const r = regionAround(TOKYO.lat, TOKYO.lon, 500);
    expect(r.latitude).toBe(TOKYO.lat);
    expect(r.longitude).toBe(TOKYO.lon);
  });

  it("半径 500m ならおよそ 1km 四方になる", () => {
    // 緯度 1 度 ≒ 111km。1km / 111km ≒ 0.009 度
    const r = regionAround(TOKYO.lat, TOKYO.lon, 500);
    expect(r.latitudeDelta).toBeCloseTo(0.009, 3);
  });

  it("半径を倍にすると範囲も倍になる", () => {
    const small = regionAround(TOKYO.lat, TOKYO.lon, 500);
    const large = regionAround(TOKYO.lat, TOKYO.lon, 1000);
    expect(large.latitudeDelta).toBeCloseTo(small.latitudeDelta * 2, 5);
  });

  it("緯度が高いほど経度方向を広く取る", () => {
    // 経線は極に近づくほど間隔が狭まるので、同じ距離でも度数は大きくなる
    const tokyo = regionAround(35.62, 139.7, 500);
    const equator = regionAround(0, 139.7, 500);
    expect(tokyo.longitudeDelta).toBeGreaterThan(equator.longitudeDelta);
  });

  it("赤道では緯度と経度の幅がほぼ等しい", () => {
    const r = regionAround(0, 139.7, 500);
    expect(r.longitudeDelta).toBeCloseTo(r.latitudeDelta, 5);
  });

  it("東京では経度方向が緯度方向の約 1.2 倍になる", () => {
    // 1 / cos(35.62°) ≒ 1.23
    const r = regionAround(TOKYO.lat, TOKYO.lon, 500);
    expect(r.longitudeDelta / r.latitudeDelta).toBeCloseTo(1.23, 2);
  });

  it("極端な緯度でも 0 除算にならない", () => {
    const r = regionAround(89.999, 0, 500);
    expect(Number.isFinite(r.longitudeDelta)).toBe(true);
  });
});
