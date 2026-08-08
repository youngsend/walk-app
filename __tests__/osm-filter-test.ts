import { isWalkable, tilesForNodes } from "@/lib/osm-filter";
import { tileKey } from "@/lib/tiles";

describe("isWalkable", () => {
  it("生活道路や歩行者専用道は通す", () => {
    for (const highway of [
      "residential",
      "unclassified",
      "footway",
      "path",
      "pedestrian",
      "steps",
      "service",
      "living_street",
      "tertiary",
      "secondary",
      "primary",
    ]) {
      expect(isWalkable({ highway })).toBe(true);
    }
  });

  it("歩行者が入れない道を落とす", () => {
    // docs/design.md#13-コストモデル の「通行不可とする道」
    expect(isWalkable({ highway: "motorway" })).toBe(false);
    expect(isWalkable({ highway: "trunk" })).toBe(false);
    expect(isWalkable({ highway: "motorway_link" })).toBe(false);
    expect(isWalkable({ highway: "trunk_link" })).toBe(false);
  });

  it("徒歩を禁じている道を落とす", () => {
    expect(isWalkable({ highway: "residential", foot: "no" })).toBe(false);
  });

  it("私有地を落とす", () => {
    expect(isWalkable({ highway: "service", access: "private" })).toBe(false);
  });

  it("工事中や計画中を落とす", () => {
    expect(isWalkable({ highway: "construction" })).toBe(false);
    expect(isWalkable({ highway: "proposed" })).toBe(false);
  });

  it("highway が無いものを落とす", () => {
    // 建物や土地利用など、道ではない way
    expect(isWalkable({})).toBe(false);
    expect(isWalkable({ building: "yes" })).toBe(false);
  });

  it("知らない種別は通す", () => {
    // cycleway や rest_area など。係数は 1.0 に落ちる
    expect(isWalkable({ highway: "cycleway" })).toBe(true);
    expect(isWalkable({ highway: "何か新しい種別" })).toBe(true);
  });

  it("foot が no 以外なら落とさない", () => {
    expect(isWalkable({ highway: "primary", foot: "yes" })).toBe(true);
    expect(isWalkable({ highway: "primary", foot: "designated" })).toBe(true);
  });
});

describe("tilesForNodes", () => {
  it("1 つのタイルに収まる way は 1 枚だけ返す", () => {
    const tiles = tilesForNodes([
      { lat: 35.625, lon: 139.705 },
      { lat: 35.63, lon: 139.71 },
    ]);
    expect(tiles).toHaveLength(1);
    expect(tileKey(tiles[0])).toBe("6985/1781");
  });

  it("境界をまたぐ way は両方のタイルを返す", () => {
    // ここが肝。way は構成ノードが入るタイルすべてに入れる
    const tiles = tilesForNodes([
      { lat: 35.625, lon: 139.71 }, // 6985/1781
      { lat: 35.625, lon: 139.73 }, // 6986/1781
    ]);
    expect(tiles.map(tileKey).sort()).toEqual(["6985/1781", "6986/1781"]);
  });

  it("同じタイルを重複して返さない", () => {
    const tiles = tilesForNodes([
      { lat: 35.625, lon: 139.705 },
      { lat: 35.626, lon: 139.706 },
      { lat: 35.627, lon: 139.707 },
    ]);
    expect(tiles).toHaveLength(1);
  });

  it("斜めに長い way は 4 枚返すこともある", () => {
    const tiles = tilesForNodes([
      { lat: 35.625, lon: 139.705 },
      { lat: 35.645, lon: 139.725 },
    ]);
    expect(tiles.map(tileKey).sort()).toEqual(["6985/1781", "6986/1782"]);
  });

  it("空なら空を返す", () => {
    expect(tilesForNodes([])).toEqual([]);
  });
});
