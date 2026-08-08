import { Database } from "./db";

/**
 * probe DB の開閉と削除。
 *
 * expo-sqlite は**開いたままの接続があると削除に失敗する**
 * （「Calling the deleteDatabaseAsync function has failed」）。
 * 接続を持ち回り、削除の前に必ず閉じる。
 *
 * expo-sqlite を直接触らず口を型で切ってあるのは、この順序を
 * テストで確かめられるようにするため。
 */

export type ProbeConnection = Database & {
  closeAsync(): Promise<void>;
};

export type ProbeSqlite = {
  openDatabaseAsync(name: string): Promise<ProbeConnection>;
  deleteDatabaseAsync(name: string): Promise<void>;
};

export type ProbeStore = {
  open(): Promise<Database>;
  close(): Promise<void>;
  remove(): Promise<void>;
};

export function createProbeStore(sqlite: ProbeSqlite, name: string): ProbeStore {
  let handle: ProbeConnection | null = null;

  async function open(): Promise<Database> {
    if (!handle) {
      handle = await sqlite.openDatabaseAsync(name);
    }
    return handle;
  }

  async function close(): Promise<void> {
    if (!handle) return;
    // 先に手放す。閉じる途中で失敗しても、古い接続を掴み続けない
    const current = handle;
    handle = null;
    await current.closeAsync();
  }

  async function remove(): Promise<void> {
    await close();
    await sqlite.deleteDatabaseAsync(name);
  }

  return { open, close, remove };
}
