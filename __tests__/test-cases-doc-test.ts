import fs from "fs";
import path from "path";

/**
 * docs/test-cases.md の「ケース」欄と、テストコードの it(...) を一致させる。
 *
 * 片方だけ増えるのを防ぐための番人。手で照合していたら何度も漏らしたので、
 * テストとして落ちるようにした。
 */
const ROOT = path.join(__dirname, "..");
const DOC = path.join(ROOT, "docs", "test-cases.md");

function testNames(): string[] {
  const names: string[] = [];
  for (const file of fs.readdirSync(__dirname)) {
    if (!file.endsWith("-test.ts")) continue;
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    for (const m of source.matchAll(/\bit\(\s*["'`](.+?)["'`]/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

describe("docs/test-cases.md", () => {
  it("すべてのテストケースが md に載っている", () => {
    const doc = fs.readFileSync(DOC, "utf8");
    const missing = testNames().filter((name) => !doc.includes(name));

    expect(missing).toEqual([]);
  });

  it("テストケースを 1 件以上見つけられている", () => {
    // 正規表現が壊れて 0 件になると、上のテストが素通りしてしまう
    expect(testNames().length).toBeGreaterThan(50);
  });
});
