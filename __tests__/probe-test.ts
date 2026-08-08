import { DatabaseSync } from "node:sqlite";

import { Database } from "@/lib/db";
import { databaseBytes, growProbe, initProbe, probeQuery } from "@/lib/probe";

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

const MB = 1024 * 1024;

async function fresh(): Promise<Database> {
  const db = memoryDatabase();
  await initProbe(db);
  return db;
}

describe("databaseBytes", () => {
  it("空の DB でもサイズを返す", async () => {
    const db = await fresh();
    expect(await databaseBytes(db)).toBeGreaterThanOrEqual(0);
  });

  it("行を足すと増える", async () => {
    const db = await fresh();
    const before = await databaseBytes(db);
    await growProbe(db, 2 * MB);
    expect(await databaseBytes(db)).toBeGreaterThan(before);
  });
});

describe("growProbe", () => {
  it("目標サイズまで膨らませる", async () => {
    const db = await fresh();
    await growProbe(db, 3 * MB);

    const bytes = await databaseBytes(db);
    expect(bytes).toBeGreaterThanOrEqual(3 * MB);
    // 1MB 単位で足すので、行きすぎても 1 行分に収まる
    expect(bytes).toBeLessThan(5 * MB);
  });

  it("すでに目標に達していれば何も足さない", async () => {
    const db = await fresh();
    await growProbe(db, 2 * MB);
    const rows = (await probeQuery(db)).rows;

    await growProbe(db, 1 * MB);
    expect((await probeQuery(db)).rows).toBe(rows);
  });

  it("進捗を報告する", async () => {
    const db = await fresh();
    const seen: number[] = [];
    await growProbe(db, 3 * MB, (bytes) => {
      seen.push(bytes);
    });

    expect(seen.length).toBeGreaterThan(0);
    // 単調に増えること
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(3 * MB);
  });

  it("中断できる", async () => {
    const db = await fresh();
    let calls = 0;
    await growProbe(db, 100 * MB, () => {
      calls++;
      return calls < 2; // false を返した時点で止める
    });
    expect(await databaseBytes(db)).toBeLessThan(10 * MB);
  });
});

describe("probeQuery", () => {
  it("行数と、読み出したデータのサイズを返す", async () => {
    const db = await fresh();
    await growProbe(db, 2 * MB);

    const result = await probeQuery(db);
    expect(result.rows).toBeGreaterThan(0);
    expect(result.sampleBytes).toBeGreaterThan(0);
  });

  it("空でも落ちない", async () => {
    const db = await fresh();
    const result = await probeQuery(db);
    expect(result.rows).toBe(0);
    expect(result.sampleBytes).toBe(0);
  });
});
