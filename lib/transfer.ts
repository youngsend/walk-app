/**
 * 道路網 DB を自宅 Wi-Fi 越しに端末へ入れる。
 * docs/development-plan.md の Step 3-3 / docs/requirements.md#f-10
 *
 * 通信そのものは画面側が `expo-file-system` で行う。
 * ここには**判断だけ**を置いて、実機なしで確かめられるようにしてある。
 */

/** 端末を満杯にしないための余白。 */
export const SPACE_MARGIN_BYTES = 300 * 1024 * 1024;

/** Mac 側の `scripts/serve-db.ts` が配るファイル名。 */
export const DB_FILE_NAME = "walk.db";

export type SpaceCheck =
  | { ok: true; needed: number; available: number }
  | { ok: false; needed: number; available: number; shortfall: number };

/**
 * 転送を始めてよいか。
 *
 * [F-10](../docs/requirements.md#f-10-オフラインデータの一括投入) は
 * 「投入前に空き容量を確認し、足りなければ開始しない」と決めている。
 * 670MB を途中まで書いて失敗すると、消し方が分からないまま容量を失う。
 *
 * `replacing` は入れ替え前の DB の大きさ。先に消してから入れるので、
 * そのぶんは空きとして数えてよい（年 1 回の地図更新がこれに当たる）。
 */
export function checkSpace(input: {
  needed: number;
  available: number;
  replacing?: number;
}): SpaceCheck {
  const { needed, available } = input;
  const effective = available + (input.replacing ?? 0);
  const required = needed + SPACE_MARGIN_BYTES;

  // 大きさが分からないまま始めない。HEAD が Content-Length を返さない場合
  if (needed <= 0) {
    return { ok: false, needed, available, shortfall: required };
  }

  if (effective < required) {
    return { ok: false, needed, available, shortfall: required - effective };
  }
  return { ok: true, needed, available };
}

/**
 * DB を書き込む先の `file://` URI。
 *
 * `expo-sqlite` の `defaultDatabaseDirectory` が素のパスで来るか
 * `file://` 付きで来るかは環境によるため、どちらでも受ける。
 * 進捗を出すために使う legacy の `createDownloadResumable` は
 * `file://` URI しか受け付けない。
 */
export function databaseFileUri(directory: string, name: string): string {
  const withScheme = directory.startsWith("file://")
    ? directory
    : `file://${directory}`;
  return `${withScheme.replace(/\/+$/, "")}/${name}`;
}

/**
 * 入力されたホストから取得先の URL を組む。
 *
 * 手で打ち込むため、URL をまるごと貼られることも、
 * IP だけを書かれることもある。どちらも受ける。
 */
export function dbUrl(host: string, port: number): string {
  const trimmed = host.trim();
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}:${port}/${DB_FILE_NAME}`;
}
