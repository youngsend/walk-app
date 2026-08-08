import { DatabaseSync } from "node:sqlite";

import { Database } from "@/lib/db";
import {
  DECAY_DAYS,
  HISTORY_MAX,
  clearWalked,
  edgeKey,
  historyFactor,
  initHistorySchema,
  loadWalked,
  markWalked,
} from "@/lib/history";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 9);

describe("historyFactor", () => {
  it("歩いていない区間は 1.0", () => {
    expect(historyFactor(undefined, NOW)).toBe(1.0);
  });

  it("歩いた直後は上限になる", () => {
    // docs/design.md#13-コストモデル の 3.0
    expect(historyFactor(NOW, NOW)).toBe(HISTORY_MAX);
  });

  it("時間が経つと 1.0 に戻る", () => {
    expect(historyFactor(NOW - DECAY_DAYS * DAY, NOW)).toBe(1.0);
  });

  it("減衰しきったあとも 1.0 より下がらない", () => {
    // 未踏の道より安くなってはいけない。安くなると古い道ばかり選ぶ
    expect(historyFactor(NOW - 365 * DAY, NOW)).toBe(1.0);
  });

  it("途中は直線的に下がる", () => {
    const half = historyFactor(NOW - (DECAY_DAYS / 2) * DAY, NOW);
    expect(half).toBeCloseTo(1 + (HISTORY_MAX - 1) / 2, 5);
  });

  it("新しく歩いたほうが高い", () => {
    // **大小関係そのものが要件。** 最近歩いた道ほど強く避ける
    const recent = historyFactor(NOW - 1 * DAY, NOW);
    const old = historyFactor(NOW - 10 * DAY, NOW);
    expect(recent).toBeGreaterThan(old);
  });

  it("未来の日時でも上限を超えない", () => {
    // 端末の時計がずれた場合
    expect(historyFactor(NOW + 10 * DAY, NOW)).toBe(HISTORY_MAX);
  });
});

describe("edgeKey", () => {
  it("way と両端のノードで区間を表す", () => {
    // docs/design.md#35-更新に耐える-id-設計。
    // 内部の連番だと DB を作り直すたびに記録が消える
    expect(edgeKey({ wayId: 12, from: 3, to: 9 })).toBe("12/3/9");
  });

  it("向きが逆でも同じ区間とみなす", () => {
    // 徒歩なので往復は同じ道。逆向きに歩いたら別扱い、では困る
    expect(edgeKey({ wayId: 12, from: 9, to: 3 })).toBe(
      edgeKey({ wayId: 12, from: 3, to: 9 }),
    );
  });

  it("way が違えば別の区間になる", () => {
    expect(edgeKey({ wayId: 13, from: 3, to: 9 })).not.toBe(
      edgeKey({ wayId: 12, from: 3, to: 9 }),
    );
  });
});

describe("歩いた区間の保存", () => {
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

  async function fresh() {
    const db = memoryDatabase();
    await initHistorySchema(db);
    return db;
  }

  const A = { wayId: 12, from: 3, to: 9 };
  const B = { wayId: 13, from: 9, to: 20 };

  it("何度呼んでも落ちない", async () => {
    const db = memoryDatabase();
    await initHistorySchema(db);
    await initHistorySchema(db);
    expect(await loadWalked(db)).toEqual(new Map());
  });

  it("歩いた区間を日時つきで記録する", async () => {
    const db = await fresh();
    await markWalked(db, [A, B], NOW);

    const walked = await loadWalked(db);
    expect(walked.get(edgeKey(A))).toBe(NOW);
    expect(walked.get(edgeKey(B))).toBe(NOW);
  });

  it("同じ区間を二度歩いたら日時が新しくなる", async () => {
    // 避ける強さは直近に歩いた時点から測る
    const db = await fresh();
    await markWalked(db, [A], NOW - 10 * DAY);
    await markWalked(db, [A], NOW);

    expect((await loadWalked(db)).get(edgeKey(A))).toBe(NOW);
  });

  it("向きが逆でも同じ区間として記録する", async () => {
    const db = await fresh();
    await markWalked(db, [{ wayId: 12, from: 9, to: 3 }], NOW);

    expect((await loadWalked(db)).get(edgeKey(A))).toBe(NOW);
  });

  it("記録が無ければ空を返す", async () => {
    expect(await loadWalked(await fresh())).toEqual(new Map());
  });

  it("空の配列を渡しても落ちない", async () => {
    const db = await fresh();
    await markWalked(db, [], NOW);
    expect(await loadWalked(db)).toEqual(new Map());
  });

  it("すべて消せる", async () => {
    // 開発用。多様性の挙動を何度も試すため
    const db = await fresh();
    await markWalked(db, [A, B], NOW);
    await clearWalked(db);
    expect(await loadWalked(db)).toEqual(new Map());
  });
});
