import { TileData } from "./overpass";
import { TileId } from "./tiles";

/**
 * 必要なタイルが手元に揃っているか確かめ、足りなければ取得する。
 * docs/development-plan.md の Step 1-6
 *
 * 取得済みなら通信しない。1 枚失敗しても残りは続ける
 * （Overpass はタイルによって 504 を返すことがある）。
 *
 * DB と通信の口を引数で受けるのは、実機なしでテストするため。
 */

export type TileSource = {
  hasTile(tile: TileId): Promise<boolean>;
  saveTile(tile: TileId, data: TileData): Promise<void>;
  fetchTile(tile: TileId): Promise<TileData>;
};

export type EnsureOptions = {
  /**
   * 通信してよいか。false を返すと取得せず skipped に入れる。
   * モバイル通信中は自動取得しない（F-8）ための口。
   */
  canFetch?: () => boolean;
  onProgress?: (done: number, total: number) => void;
};

export type EnsureResult = {
  /** 新しく取得したタイル */
  fetched: TileId[];
  /** すでに手元にあったタイル */
  present: TileId[];
  /** 通信を許されず取得しなかったタイル */
  skipped: TileId[];
  failed: { tile: TileId; error: string }[];
};

export async function ensureTiles(
  tiles: TileId[],
  source: TileSource,
  options: EnsureOptions = {},
): Promise<EnsureResult> {
  const result: EnsureResult = { fetched: [], present: [], skipped: [], failed: [] };
  const total = tiles.length;
  let done = 0;

  for (const tile of tiles) {
    try {
      if (await source.hasTile(tile)) {
        result.present.push(tile);
      } else if (options.canFetch && !options.canFetch()) {
        result.skipped.push(tile);
      } else {
        await source.saveTile(tile, await source.fetchTile(tile));
        result.fetched.push(tile);
      }
    } catch (e) {
      // 1 枚の失敗で全体を止めない
      result.failed.push({
        tile,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    done++;
    options.onProgress?.(done, total);
  }

  return result;
}
