import { Database } from "./db";

/**
 * Expo Go が大きな DB を扱えるかを確かめるための使い捨ての DB。
 * docs/development-plan.md の Step 1-4
 *
 * [F-10](../docs/requirements.md) は約 800〜900MB の DB を端末に置く。
 * 扱えなければ「ネイティブビルド不要」という前提が崩れるため、
 * 経路探索を作り込む前にここで潰しておく。
 *
 * 中身に意味は無いので randomblob で 1MB ずつ膨らませる。
 * 実データ相当の行数を挿入すると時間がかかりすぎる（それを避けるのが F-10 の設計）。
 */

/** F-10 で置く DB の想定サイズ。docs/design.md#32-サイズの見積り */
export const TARGET_BYTES = 900 * 1024 * 1024;

const CHUNK_BYTES = 1024 * 1024;

export async function initProbe(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS probe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload BLOB NOT NULL
    );
  `);
}

/** ファイルサイズ。ページ数×ページサイズで、ファイルを読まずに分かる。 */
export async function databaseBytes(db: Database): Promise<number> {
  const pageCount = await db.getFirstAsync<{ page_count: number }>(
    "PRAGMA page_count",
  );
  const pageSize = await db.getFirstAsync<{ page_size: number }>("PRAGMA page_size");
  return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
}

/**
 * 目標サイズに達するまで 1MB ずつ足す。
 * onProgress が false を返したら中断する（画面から止められるように）。
 */
export async function growProbe(
  db: Database,
  targetBytes: number,
  onProgress?: (bytes: number) => boolean | void,
): Promise<void> {
  let bytes = await databaseBytes(db);
  while (bytes < targetBytes) {
    await db.runAsync(`INSERT INTO probe (payload) VALUES (randomblob(${CHUNK_BYTES}))`);
    bytes = await databaseBytes(db);
    if (onProgress?.(bytes) === false) return;
  }
}

/** 実際に読めるかを確かめる。行数と、読み出した 1 行のサイズを返す。 */
export async function probeQuery(
  db: Database,
): Promise<{ rows: number; sampleBytes: number }> {
  const count = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM probe",
  );
  const rows = count?.n ?? 0;
  if (rows === 0) return { rows: 0, sampleBytes: 0 };

  // 末尾の行を引く。全体を走査しないと届かない位置を選ぶ
  const sample = await db.getFirstAsync<{ size: number }>(
    "SELECT LENGTH(payload) AS size FROM probe ORDER BY id DESC LIMIT 1",
  );
  return { rows, sampleBytes: sample?.size ?? 0 };
}
