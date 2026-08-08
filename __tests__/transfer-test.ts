import {
  SPACE_MARGIN_BYTES,
  checkSpace,
  databaseFileUri,
  dbUrl,
} from "@/lib/transfer";

const MB = 1024 * 1024;

describe("checkSpace", () => {
  it("空きが足りていれば通す", () => {
    const result = checkSpace({ needed: 700 * MB, available: 5000 * MB });
    expect(result.ok).toBe(true);
  });

  it("空きが足りなければ止める", () => {
    // F-10 は「投入前に空き容量を確認し、足りなければ開始しない」。
    // 670MB を転送しきれずに失敗させないため
    const result = checkSpace({ needed: 700 * MB, available: 100 * MB });
    expect(result.ok).toBe(false);
  });

  it("足りないときは不足分を返す", () => {
    const result = checkSpace({ needed: 700 * MB, available: 100 * MB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.shortfall).toBe(700 * MB + SPACE_MARGIN_BYTES - 100 * MB);
    }
  });

  it("ちょうどの空きは足りないとみなす", () => {
    // 端末を満杯にしない。余白を残す
    const result = checkSpace({ needed: 700 * MB, available: 700 * MB });
    expect(result.ok).toBe(false);
  });

  it("余白のぶんまで空いていれば通す", () => {
    const result = checkSpace({
      needed: 700 * MB,
      available: 700 * MB + SPACE_MARGIN_BYTES,
    });
    expect(result.ok).toBe(true);
  });

  it("入れ替えなら古い DB のぶんを空きに数える", () => {
    // 年 1 回の更新では、古い DB を消してから入れるので実質の空きは増える。
    // 400MB しか空いていなくても、700MB を消せば 1,100MB になり
    // 700MB + 余白 300MB に届く
    const args = { needed: 700 * MB, available: 400 * MB };
    expect(checkSpace(args).ok).toBe(false);
    expect(checkSpace({ ...args, replacing: 700 * MB }).ok).toBe(true);
  });

  it("大きさが分からなければ止める", () => {
    // HEAD が Content-Length を返さなかった場合。当て推量で始めない
    expect(checkSpace({ needed: 0, available: 5000 * MB }).ok).toBe(false);
  });
});

describe("dbUrl", () => {
  it("ホストとポートから URL を組む", () => {
    expect(dbUrl("192.168.1.5", 8080)).toBe("http://192.168.1.5:8080/walk.db");
  });

  it("ホストに書かれた余分な空白を落とす", () => {
    // 手で打ち込むため
    expect(dbUrl("  192.168.1.5 ", 8080)).toBe("http://192.168.1.5:8080/walk.db");
  });

  it("すでに URL の形なら、そのまま使う", () => {
    expect(dbUrl("http://192.168.1.5:9999/walk.db", 8080)).toBe(
      "http://192.168.1.5:9999/walk.db",
    );
  });
});

describe("databaseFileUri", () => {
  it("file:// が無ければ付ける", () => {
    // expo-sqlite の defaultDatabaseDirectory が素のパスで来る場合。
    // legacy の createDownloadResumable は file:// URI しか受けない
    expect(databaseFileUri("/var/mobile/app/SQLite", "walk.db")).toBe(
      "file:///var/mobile/app/SQLite/walk.db",
    );
  });

  it("file:// が付いていればそのまま使う", () => {
    expect(databaseFileUri("file:///var/mobile/app/SQLite", "walk.db")).toBe(
      "file:///var/mobile/app/SQLite/walk.db",
    );
  });

  it("末尾のスラッシュが重ならない", () => {
    expect(databaseFileUri("file:///var/mobile/app/SQLite/", "walk.db")).toBe(
      "file:///var/mobile/app/SQLite/walk.db",
    );
  });
});
