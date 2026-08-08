import { createProbeStore, ProbeSqlite } from "@/lib/probe-store";

/**
 * expo-sqlite を模したフェイク。
 * **開いたままの接続があると削除が失敗する**という実際の挙動を再現する。
 * これが「Calling the deleteDatabaseAsync function has failed」の原因だった。
 */
function fakeSqlite() {
  const log: string[] = [];
  let openCount = 0;
  let deleted = false;

  const sqlite: ProbeSqlite = {
    async openDatabaseAsync(name: string) {
      openCount++;
      deleted = false;
      log.push(`open:${name}`);
      return {
        execAsync: async () => {},
        runAsync: async () => undefined,
        getAllAsync: async () => [],
        getFirstAsync: async () => null,
        closeAsync: async () => {
          openCount--;
          log.push("close");
        },
      };
    },
    async deleteDatabaseAsync(name: string) {
      if (openCount > 0) {
        throw new Error("Calling the deleteDatabaseAsync function has failed");
      }
      deleted = true;
      log.push(`delete:${name}`);
    },
  };

  return { sqlite, log, isDeleted: () => deleted };
}

describe("createProbeStore", () => {
  it("二度開いても接続を使い回す", async () => {
    const { sqlite, log } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");

    await store.open();
    await store.open();

    expect(log.filter((l) => l.startsWith("open:"))).toHaveLength(1);
  });

  it("削除する前に接続を閉じる", async () => {
    // 回帰テスト。閉じずに削除しようとして失敗していた
    const { sqlite, log, isDeleted } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");

    await store.open();
    await store.remove();

    expect(isDeleted()).toBe(true);
    expect(log).toEqual(["open:probe.db", "close", "delete:probe.db"]);
  });

  it("開いていなくても削除できる", async () => {
    const { sqlite, isDeleted } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");

    await store.remove();
    expect(isDeleted()).toBe(true);
  });

  it("削除したあとに開くと、新しい接続になる", async () => {
    const { sqlite, log } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");

    await store.open();
    await store.remove();
    await store.open();

    expect(log.filter((l) => l.startsWith("open:"))).toHaveLength(2);
  });

  it("閉じたあとに閉じても落ちない", async () => {
    const { sqlite } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");

    await store.open();
    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("開いていない状態で閉じても落ちない", async () => {
    const { sqlite } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db");
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("削除に失敗したら、接続を持ち越さない", async () => {
    // 失敗しても handle が残っていると、次の削除も失敗し続ける
    const { sqlite } = fakeSqlite();
    const broken: ProbeSqlite = {
      openDatabaseAsync: sqlite.openDatabaseAsync,
      deleteDatabaseAsync: async () => {
        throw new Error("削除できない");
      },
    };
    const store = createProbeStore(broken, "probe.db");

    await store.open();
    await expect(store.remove()).rejects.toThrow("削除できない");

    // 閉じるところまでは済んでいるので、閉じ直しは何もしない
    await expect(store.close()).resolves.toBeUndefined();
  });
});
