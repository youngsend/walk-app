import { Database } from "./db";

/**
 * 歩いた区間を避けるための係数。docs/requirements.md#f-9-ルートの多様性
 *
 * コストは `距離 × 種別係数 × 履歴係数`。歩いた道の係数を上げ、
 * 時間が経つと 1.0 に戻す。これで「毎回違うルート」を出す。
 */

/** 歩いた直後の係数。docs/design.md#13-コストモデル */
export const HISTORY_MAX = 3.0;

/** 1.0 に戻るまでの日数。 */
export const DECAY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 区間の履歴係数。歩いていなければ 1.0、歩いた直後は HISTORY_MAX。
 *
 * **1.0 を下回らせない。** 下回ると歩いた道が未踏の道より安くなり、
 * 「毎回違う道」の逆になる。
 */
export function historyFactor(walkedAt: number | undefined, now: number): number {
  if (walkedAt === undefined) return 1.0;

  const elapsedDays = (now - walkedAt) / DAY_MS;
  // 端末の時計がずれて未来の日時が入っていても上限で止める
  if (elapsedDays <= 0) return HISTORY_MAX;
  if (elapsedDays >= DECAY_DAYS) return 1.0;

  return HISTORY_MAX - (HISTORY_MAX - 1) * (elapsedDays / DECAY_DAYS);
}

/**
 * 区間を表す文字列。**OSM の way ID と両端の node ID で持つ。**
 *
 * 内部で振った連番だと、DB を作り直すたびに対応が崩れて記録が消える
 * （docs/design.md#35-更新に耐える-id-設計）。
 * 徒歩なので往復は同じ道。node ID を並べ替えて向きを無視する。
 */
export function edgeKey(edge: { wayId: number; from: number; to: number }): string {
  const [a, b] = edge.from <= edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
  return `${edge.wayId}/${a}/${b}`;
}

/**
 * 歩いた区間の保存。
 *
 * **道路網とは別の DB ファイルに置く。** 道路網の投入は walk.db を
 * 丸ごと上書きするので、同じファイルに入れると年 1 回の地図更新で
 * 記録が全部消える（docs/requirements.md#f-10-オフラインデータの一括投入 の
 * 「更新しても記録が失われないこと」）。
 */
export async function initHistorySchema(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS walked (
      way_id INTEGER NOT NULL,
      -- 両端の node ID。小さいほうを node_a に入れて向きを無視する
      node_a INTEGER NOT NULL,
      node_b INTEGER NOT NULL,
      walked_at INTEGER NOT NULL,
      PRIMARY KEY (way_id, node_a, node_b)
    );
  `);
}

export type WalkedEdge = { wayId: number; from: number; to: number };

/** 通った区間を記録する。同じ区間なら日時を新しくする。 */
export async function markWalked(
  db: Database,
  edges: WalkedEdge[],
  at: number = Date.now(),
): Promise<void> {
  for (const edge of edges) {
    const [a, b] = edge.from <= edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
    await db.runAsync(
      "INSERT OR REPLACE INTO walked (way_id, node_a, node_b, walked_at) VALUES (?, ?, ?, ?)",
      edge.wayId,
      a,
      b,
      at,
    );
  }
}

/** 区間キー → 最後に歩いた日時。 */
export async function loadWalked(db: Database): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{
    way_id: number;
    node_a: number;
    node_b: number;
    walked_at: number;
  }>("SELECT way_id, node_a, node_b, walked_at FROM walked");

  const walked = new Map<string, number>();
  for (const r of rows) {
    walked.set(`${r.way_id}/${r.node_a}/${r.node_b}`, r.walked_at);
  }
  return walked;
}

/** すべて忘れる。開発用に、多様性の挙動を何度も試すため。 */
export async function clearWalked(db: Database): Promise<void> {
  await db.execAsync("DELETE FROM walked;");
}
