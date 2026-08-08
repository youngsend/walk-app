import {
  TILE_SIZE,
  parseTileKey,
  tileAt,
  tileBounds,
  tileKey,
  tilesAround,
  tilesForRoute,
} from "@/lib/tiles";

/** 開発時の初期エリア。docs/design.md#21-タイルの定義 */
const DEV = { lat: 35.62, lon: 139.7 };

describe("tileAt", () => {
  it("開発エリアが実測したタイルと一致する", () => {
    expect(tileAt(DEV.lat, DEV.lon)).toEqual({ x: 6985, y: 1781 });
  });

  it("タイル境界ちょうどの座標が、そのタイルの内側に入る", () => {
    // 度のまま割ると 139.70 / 0.02 = 6984.999999999999 となり
    // 隣のタイルに落ちる。整数に直してから割ることで防いでいる
    expect(tileAt(35.62, 139.7)).toEqual({ x: 6985, y: 1781 });
    expect(tileAt(35.64, 139.72)).toEqual({ x: 6986, y: 1782 });
    expect(tileAt(24.26, 124.26)).toEqual({ x: 6213, y: 1213 });
    expect(tileAt(28.26, 128.26)).toEqual({ x: 6413, y: 1413 });
  });

  it("任意の座標が、自分のタイルの範囲内に収まる", () => {
    // tileAt は OSM の座標精度（小数 7 桁）に丸めてから判定する。
    // 比較もその精度に揃える。揃えないと 29.759999999999998 のような
    // テスト側の計算誤差を、実装の誤りとして拾ってしまう
    const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

    for (let i = 0; i < 20000; i++) {
      // 日本をおおよそ覆う範囲
      const lat = round7(24 + (i % 500) * 0.045);
      const lon = round7(123 + Math.floor(i / 500) * 0.5);
      const tile = tileAt(lat, lon);
      const b = tileBounds(tile);
      expect(lat).toBeGreaterThanOrEqual(round7(b.south));
      expect(lat).toBeLessThan(round7(b.north));
      expect(lon).toBeGreaterThanOrEqual(round7(b.west));
      expect(lon).toBeLessThan(round7(b.east));
    }
  });

  it("小数 7 桁より細かい差は無視して上のタイルに入れる", () => {
    // 境界のわずかに下でも、OSM の精度では境界そのもの
    expect(tileAt(35.62 - 1e-9, 139.7 - 1e-9)).toEqual({ x: 6985, y: 1781 });
    // 7 桁で表せる差なら下のタイルに入る
    expect(tileAt(35.6199999, 139.6999999)).toEqual({ x: 6984, y: 1780 });
  });

  it("負の座標でも下側に丸める", () => {
    expect(tileAt(0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileAt(-0.02, -0.02)).toEqual({ x: -1, y: -1 });
    expect(tileAt(-0.021, -0.021)).toEqual({ x: -2, y: -2 });
  });
});

describe("tileBounds", () => {
  it("誤差のない値を返す", () => {
    expect(tileBounds({ x: 6985, y: 1781 })).toEqual({
      south: 35.62,
      west: 139.7,
      north: 35.64,
      east: 139.72,
    });
  });

  it("1 辺が TILE_SIZE になる", () => {
    const b = tileBounds(tileAt(DEV.lat, DEV.lon));
    expect(b.north - b.south).toBeCloseTo(TILE_SIZE, 10);
    expect(b.east - b.west).toBeCloseTo(TILE_SIZE, 10);
  });

  it("隣接タイルが隙間なく接する", () => {
    const tile = { x: 6985, y: 1781 };
    const here = tileBounds(tile);
    const right = tileBounds({ x: tile.x + 1, y: tile.y });
    const above = tileBounds({ x: tile.x, y: tile.y + 1 });
    expect(here.east).toBe(right.west);
    expect(here.north).toBe(above.south);
  });
});

describe("tileKey", () => {
  it("往復して元に戻る", () => {
    for (const tile of [
      { x: 6985, y: 1781 },
      { x: 0, y: 0 },
      { x: -2, y: -3 },
    ]) {
      expect(parseTileKey(tileKey(tile))).toEqual(tile);
    }
  });
});

describe("tilesAround", () => {
  const CENTER = { x: 6985, y: 1781 };

  it("半径 0 なら中心の 1 枚だけ", () => {
    expect(tilesAround(CENTER, 0)).toEqual([CENTER]);
  });

  it("半径 1 なら 3×3 の 9 枚", () => {
    const tiles = tilesAround(CENTER, 1);
    expect(tiles).toHaveLength(9);
    expect(tiles).toContainEqual({ x: 6984, y: 1780 });
    expect(tiles).toContainEqual({ x: 6986, y: 1782 });
  });

  it("中心を必ず含む", () => {
    for (const r of [0, 1, 2, 3]) {
      expect(tilesAround(CENTER, r)).toContainEqual(CENTER);
    }
  });

  it("同じタイルを二度返さない", () => {
    const tiles = tilesAround(CENTER, 2);
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
  });
});

describe("tilesForRoute", () => {
  // **タイルの角ではない点を使う。** 開発エリア (35.62, 139.7) はちょうど
  // タイル 6985/1781 の南西角で、そこを起点にするとどの判定も素通りしてしまう
  const FROM = { lat: 35.6301, lon: 139.7099 };

  it("同じ地点なら、その 1 枚を含む", () => {
    const tiles = tilesForRoute(FROM, FROM);
    expect(tiles).toContainEqual(tileAt(FROM.lat, FROM.lon));
  });

  it("出発地と目的地のタイルを必ず含む", () => {
    const to = { lat: 35.7, lon: 139.745 };
    const tiles = tilesForRoute(FROM, to);
    expect(tiles).toContainEqual(tileAt(FROM.lat, FROM.lon));
    expect(tiles).toContainEqual(tileAt(to.lat, to.lon));
  });

  it("直線上のタイルを取りこぼさない", () => {
    // 2 点を結ぶ直線を刻んで、どの点のタイルも含まれること
    const to = { lat: 35.7, lon: 139.745 };
    const tiles = new Set(tilesForRoute(FROM, to).map(tileKey));
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const point = {
        lat: FROM.lat + (to.lat - FROM.lat) * t,
        lon: FROM.lon + (to.lon - FROM.lon) * t,
      };
      expect(tiles.has(tileKey(tileAt(point.lat, point.lon)))).toBe(true);
    }
  });

  it("遠回りを許す範囲だけ横に膨らむ", () => {
    // **これが楕円である理由。** 出発地と目的地からの距離の和が
    // 「直線 × 許容倍率」以下なら、その倍率以内の経路は必ずこの中に収まる
    const to = { lat: 35.7, lon: 139.745 };
    const narrow = tilesForRoute(FROM, to, 1.2);
    const wide = tilesForRoute(FROM, to, 2.0);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("矩形より狭い", () => {
    // 矩形（外接する長方形）より少ないこと。これが読み込みを減らす根拠
    const to = { lat: 35.7, lon: 139.745 };
    const a = tileAt(FROM.lat, FROM.lon);
    const b = tileAt(to.lat, to.lon);
    const rectangle =
      (Math.abs(a.x - b.x) + 3) * (Math.abs(a.y - b.y) + 3); // 余白 1 枚の矩形
    expect(tilesForRoute(FROM, to, 1.4).length).toBeLessThan(rectangle);
  });

  it("同じタイルを二度返さない", () => {
    const to = { lat: 35.7, lon: 139.745 };
    const tiles = tilesForRoute(FROM, to);
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
  });

  it("タイルの辺の真ん中にいても、そのタイルを返す", () => {
    // **回帰テスト。** 中心と四隅の 5 点でしか判定しておらず、辺の中央は
    // どの標本点からも遠いため、出発地を含むタイル自身が落ちて 0 枚になり、
    // 画面に「道路網が入っていない」と出ていた
    const bounds = tileBounds({ x: 6985, y: 1781 });
    const from = { lat: bounds.south + 0.0001, lon: (bounds.west + bounds.east) / 2 };
    const to = { lat: from.lat + 0.0027, lon: from.lon };

    const tiles = tilesForRoute(from, to);

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles).toContainEqual(tileAt(from.lat, from.lon));
    expect(tiles).toContainEqual(tileAt(to.lat, to.lon));
  });

  it("タイルのどこに立っても、そのタイルを返す", () => {
    // 1 枚を 20×20 に刻んで、どこを起点にしても落ちないこと
    const bounds = tileBounds({ x: 6985, y: 1781 });
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const from = {
          lat: bounds.south + (TILE_SIZE * (i + 0.5)) / 20,
          lon: bounds.west + (TILE_SIZE * (j + 0.5)) / 20,
        };
        const to = { lat: from.lat + 0.0027, lon: from.lon };
        expect(tilesForRoute(from, to)).toContainEqual(tileAt(from.lat, from.lon));
      }
    }
  });
});
