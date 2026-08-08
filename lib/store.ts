import * as SQLite from "expo-sqlite";

import { Database, initSchema } from "./db";

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
