import { spawnSync } from "child_process";
import path from "path";

/**
 * scripts/build-db.ts が「起動できること」だけを確かめる。
 *
 * 中身の抽出規則は lib/osm-filter.ts 側でテストしてある。ここが見るのは、
 * 461MB を読ませて数十分待ったあげく「そもそも起動しなかった」を防ぐこと。
 */
const ROOT = path.join(__dirname, "..");

function runWithoutArgs() {
  return spawnSync(path.join(ROOT, "node_modules", ".bin", "tsx"), [
    path.join(ROOT, "scripts", "build-db.ts"),
  ]);
}

describe("scripts/build-db.ts", () => {
  it(
    "引数が無ければ使い方を出して終わる",
    () => {
      const result = runWithoutArgs();

      expect(result.stderr.toString()).toContain("使い方");
      expect(result.status).toBe(1);
    },
    60_000,
  );

  it(
    "変換に失敗せずに読み込める",
    () => {
      // 回帰テスト。トップレベル await を書いたら tsx の CJS 変換が落ち、
      // PBF を渡す前に「Top-level await is currently not supported」で死んでいた。
      // 引数不足も変換失敗も終了コードは 1 なので、中身で見分ける。
      const result = runWithoutArgs();

      expect(result.stderr.toString()).not.toContain("Transform failed");
    },
    60_000,
  );
});
