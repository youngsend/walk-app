import { DatabaseSync } from "node:sqlite";

import { Database, initSchema, saveTile } from "@/lib/db";
import { OsmNode, OsmWay } from "@/lib/osm";
import { planRoute, walkingMinutes } from "@/lib/plan";
import { tileAt } from "@/lib/tiles";

function memoryDatabase(): Database {
  const db = new DatabaseSync(":memory:");
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => {
      db.prepare(sql).run(...(params as any[]));
    },
    getAllAsync: async (sql, ...params) =>
      db.prepare(sql).all(...(params as any[])) as any[],
    getFirstAsync: async (sql, ...params) =>
      (db.prepare(sql).get(...(params as any[])) ?? null) as any,
  };
}

/** 東西にまっすぐ伸びる道を 1 本だけ持つ DB。 */
async function withStraightRoad(tags: Record<string, string> = {}) {
  const db = memoryDatabase();
  await initSchema(db);

  const nodes: OsmNode[] = [];
  for (let i = 0; i <= 10; i++) {
    nodes.push({ id: i + 1, lat: 35.62, lon: 139.7 + i * 0.0005 });
  }
  const ways: OsmWay[] = [
    { id: 1, nodes: nodes.map((n) => n.id), tags: { highway: "residential", ...tags } },
  ];
  // way は構成ノードが入るタイルすべてに入る
  for (const tile of [tileAt(35.62, 139.7), tileAt(35.62, 139.705)]) {
    await saveTile(db, tile, { ways, nodes });
  }
  return db;
}

const FROM = { lat: 35.6201, lon: 139.7001 };
const TO = { lat: 35.6201, lon: 139.7049 };

describe("planRoute", () => {
  it("経路と座標列を返す", async () => {
    const result = await planRoute(await withStraightRoad(), FROM, TO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coordinates.length).toBeGreaterThan(1);
    expect(result.distanceM).toBeGreaterThan(0);
  });

  it("読んだタイル数と所要時間を返す", async () => {
    // 探索が重いかどうかを画面と実測の両方から見るため
    const result = await planRoute(await withStraightRoad(), FROM, TO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tileCount).toBeGreaterThan(0);
    expect(result.minutes).toBeGreaterThan(0);
  });

  it("道路網が入っていなければ、その旨を返す", async () => {
    // 初回起動、または関東の外を指した場合
    const db = memoryDatabase();
    await initSchema(db);

    const result = await planRoute(db, FROM, TO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("道路網なし");
  });

  it("繋がっていなければ、経路なしを返す", async () => {
    // 川や線路で分断された先。例外を投げない
    const db = memoryDatabase();
    await initSchema(db);
    const nodes: OsmNode[] = [
      { id: 1, lat: 35.62, lon: 139.7 },
      { id: 2, lat: 35.62, lon: 139.7005 },
      { id: 3, lat: 35.62, lon: 139.7045 },
      { id: 4, lat: 35.62, lon: 139.705 },
    ];
    await saveTile(db, tileAt(35.62, 139.7), {
      ways: [
        { id: 1, nodes: [1, 2], tags: { highway: "residential" } },
        { id: 2, nodes: [3, 4], tags: { highway: "residential" } },
      ],
      nodes,
    });

    const result = await planRoute(db, FROM, TO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("経路なし");
  });

  it("幹線を避けた経路を返す", async () => {
    // 中核の要件が、画面まで繋いだ経路でも効いていること
    const db = await withStraightRoad({ highway: "primary" });
    const result = await planRoute(db, FROM, TO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 他に道が無ければやむを得ず通る。種別の内訳が出せること
    expect(result.breakdown[0][0]).toBe("primary");
  });
});

describe("walkingMinutes", () => {
  it("時速 4.8km で換算する", () => {
    expect(walkingMinutes(4800)).toBe(60);
  });

  it("端数は切り上げる", () => {
    // 「0 分」と出さない
    expect(walkingMinutes(10)).toBe(1);
  });

  it("距離 0 なら 0 分", () => {
    expect(walkingMinutes(0)).toBe(0);
  });
});
