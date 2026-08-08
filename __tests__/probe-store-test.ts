import { createProbeStore, ProbeFiles, ProbeSqlite } from "@/lib/probe-store";

/**
 * expo-sqlite を模したフェイク。
 * **開いたままの接続があると削除が失敗する**という実際の挙動を再現する。
 * これが「Calling the deleteDatabaseAsync function has failed」の原因だった。
 */
function fakeSqlite(options: { deleteActuallyWorks?: boolean } = {}) {
  const works = options.deleteActuallyWorks ?? true;
  const log: string[] = [];
  let openCount = 0;

  const sqlite: ProbeSqlite = {
    async openDatabaseAsync(name: string) {
      openCount++;
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
      log.push(`sqliteDelete:${name}`);
      if (works) files.delete(name);
    },
  };

  /** ディスク上のファイル。 */
  const present = new Set<string>();
  const files: ProbeFiles = {
    list: () => [...present],
    delete: (name: string) => {
      log.push(`fileDelete:${name}`);
      present.delete(name);
    },
  };

  return { sqlite, files, log, present };
}

describe("createProbeStore", () => {
  it("二度開いても接続を使い回す", async () => {
    const { sqlite, files, log } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db", files);

    await store.open();
    await store.open();

    expect(log.filter((l) => l.startsWith("open:"))).toHaveLength(1);
  });

  it("削除する前に接続を閉じる", async () => {
    // 回帰テスト。閉じずに削除しようとして失敗していた
    const { sqlite, files, log, present } = fakeSqlite();
    present.add("probe.db");
    const store = createProbeStore(sqlite, "probe.db", files);

    await store.open();
    const report = await store.remove();

    expect(log.slice(0, 3)).toEqual(["open:probe.db", "close", "sqliteDelete:probe.db"]);
    expect(report.remaining).toEqual([]);
  });

  it("開いていなくても削除できる", async () => {
    const { sqlite, files, present } = fakeSqlite();
    present.add("probe.db");
    const store = createProbeStore(sqlite, "probe.db", files);

    const report = await store.remove();
    expect(report.remaining).toEqual([]);
  });

  it("expo-sqlite が消せなかったら、ファイルを直接消す", async () => {
    // 回帰テスト。deleteDatabaseAsync が成功を返してもファイルが残ることがある
    const { sqlite, files, log, present } = fakeSqlite({ deleteActuallyWorks: false });
    present.add("probe.db");
    const store = createProbeStore(sqlite, "probe.db", files);

    const report = await store.remove();

    expect(log).toContain("fileDelete:probe.db");
    expect(report.forceDeleted).toEqual(["probe.db"]);
    expect(report.remaining).toEqual([]);
  });

  it("deleteDatabaseAsync が例外を投げても、ファイルを直接消して回復する", async () => {
    const { files, present, log } = fakeSqlite();
    present.add("probe.db");
    const broken: ProbeSqlite = {
      openDatabaseAsync: async () => {
        throw new Error("使わない");
      },
      deleteDatabaseAsync: async () => {
        throw new Error("削除できない");
      },
    };
    const store = createProbeStore(broken, "probe.db", files);

    const report = await store.remove();

    expect(log).toContain("fileDelete:probe.db");
    expect(report.remaining).toEqual([]);
    expect(report.error).toMatch(/削除できない/);
  });

  it("WAL の付随ファイルも一緒に消す", async () => {
    const { sqlite, files, present } = fakeSqlite({ deleteActuallyWorks: false });
    present.add("probe.db");
    present.add("probe.db-wal");
    present.add("probe.db-shm");
    present.add("walk.db"); // 別の DB は残す
    const store = createProbeStore(sqlite, "probe.db", files);

    const report = await store.remove();

    expect(report.forceDeleted.sort()).toEqual([
      "probe.db",
      "probe.db-shm",
      "probe.db-wal",
    ]);
    expect(files.list()).toEqual(["walk.db"]);
  });

  it("それでも消えなければ、残っているものを報告する", async () => {
    const { sqlite, present } = fakeSqlite({ deleteActuallyWorks: false });
    present.add("probe.db");
    const stubborn: ProbeFiles = {
      list: () => [...present],
      delete: () => {}, // 消せない
    };
    const store = createProbeStore(sqlite, "probe.db", stubborn);

    const report = await store.remove();
    expect(report.remaining).toEqual(["probe.db"]);
  });

  it("削除したあとに開くと、新しい接続になる", async () => {
    const { sqlite, files, log } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db", files);

    await store.open();
    await store.remove();
    await store.open();

    expect(log.filter((l) => l.startsWith("open:"))).toHaveLength(2);
  });

  it("閉じたあとに閉じても落ちない", async () => {
    const { sqlite, files } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db", files);

    await store.open();
    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("開いていない状態で閉じても落ちない", async () => {
    const { sqlite, files } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db", files);
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("削除に失敗したら、接続を持ち越さない", async () => {
    // 失敗しても handle が残っていると、次の削除も失敗し続ける
    const { sqlite, files } = fakeSqlite();
    const store = createProbeStore(sqlite, "probe.db", files);

    await store.open();
    await store.remove();

    await expect(store.close()).resolves.toBeUndefined();
  });
});
