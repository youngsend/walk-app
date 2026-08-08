import * as SQLite from "expo-sqlite";

import { Database, initSchema } from "./db";
import { initHistorySchema } from "./history";

/**
 * 実機で使う DB を開く。SQL そのものは lib/db.ts にあり、
 * そちらは node:sqlite でもテストできるようにしてある。
 */
const DATABASE_NAME = "walk.db";

let opened: Promise<Database> | null = null;

export function openStore(): Promise<Database> {
  if (!opened) {
    opened = (async () => {
      const db = (await SQLite.openDatabaseAsync(DATABASE_NAME)) as unknown as Database;
      await initSchema(db);
      return db;
    })();
  }
  return opened;
}

/**
 * 接続を閉じて手放す。
 *
 * DB を入れ替える前に呼ぶ（docs/development-plan.md の Step 3-3）。
 * 開いたままのファイルを消そうとすると失敗するため。
 * probe-store で同じことをやって痛い目を見ている。
 */
export async function closeStore(): Promise<void> {
  if (!opened) return;
  // 先に手放す。閉じる途中で失敗しても古い接続を掴み続けない
  const current = opened;
  opened = null;
  try {
    const db = (await current) as unknown as { closeAsync?: () => Promise<void> };
    await db.closeAsync?.();
  } catch {
    // 閉じられなくても、掴んでいない以上は次で開き直せる
  }
}

/**
 * 歩いた区間を入れる DB。**道路網とは別ファイルにする。**
 *
 * 道路網の投入は walk.db を丸ごと上書きするので、同じファイルに
 * 記録を置くと年 1 回の地図更新で全部消える
 * （docs/requirements.md#f-10-オフラインデータの一括投入）。
 */
const HISTORY_DATABASE_NAME = "history.db";

let historyOpened: Promise<Database> | null = null;

export function openHistoryStore(): Promise<Database> {
  if (!historyOpened) {
    historyOpened = (async () => {
      const db = (await SQLite.openDatabaseAsync(
        HISTORY_DATABASE_NAME,
      )) as unknown as Database;
      await initHistorySchema(db);
      return db;
    })();
  }
  return historyOpened;
}
