import { Database } from "./db";

/**
 * probe DB の開閉と削除。
 *
 * expo-sqlite の削除は当てにしない。
 * - 開いたままの接続があると失敗する（「Calling the deleteDatabaseAsync
 *   function has failed」）
 * - 例外を投げずに成功したように見えても、ファイルが残ることがある
 *
 * そのため、接続を閉じてから削除を試み、**ディスクを見て残っていたら
 * ファイルを直接消す**。900MB を端末に置き去りにしないため。
 *
 * expo-sqlite / expo-file-system を直接触らず口を型で切ってあるのは、
 * この順序と後始末をテストで確かめられるようにするため。
 */

export type ProbeConnection = Database & {
  closeAsync(): Promise<void>;
};

export type ProbeSqlite = {
  openDatabaseAsync(name: string): Promise<ProbeConnection>;
  deleteDatabaseAsync(name: string): Promise<void>;
};

/** DB が置かれているディレクトリのファイル操作。 */
export type ProbeFiles = {
  list(): string[];
  delete(name: string): void;
};

export type RemoveReport = {
  /** 直接消したファイル。expo-sqlite が消しきれなかったもの */
  forceDeleted: string[];
  /** それでも残ったファイル */
  remaining: string[];
  /** deleteDatabaseAsync が投げた例外。投げていなければ undefined */
  error?: string;
};

export type ProbeStore = {
  open(): Promise<Database>;
  close(): Promise<void>;
  remove(): Promise<RemoveReport>;
};

/** probe.db 本体と、WAL が作る -wal / -shm。 */
function relatedTo(name: string, files: string[]): string[] {
  return files.filter((f) => f === name || f.startsWith(`${name}-`));
}

export function createProbeStore(
  sqlite: ProbeSqlite,
  name: string,
  files: ProbeFiles,
): ProbeStore {
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

  async function remove(): Promise<RemoveReport> {
    await close();

    let error: string | undefined;
    try {
      await sqlite.deleteDatabaseAsync(name);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    // 消えたと言われても信じず、ディスクを見る
    const forceDeleted: string[] = [];
    for (const file of relatedTo(name, files.list())) {
      files.delete(file);
      forceDeleted.push(file);
    }

    return {
      forceDeleted,
      remaining: relatedTo(name, files.list()),
      error,
    };
  }

  return { open, close, remove };
}
