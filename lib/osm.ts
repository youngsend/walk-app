/**
 * OpenStreetMap から取り込んだ道路データの形。
 *
 * Geofabrik の抽出ファイルを Mac で前処理して入れる
 * （docs/design.md#3-オフラインデータの一括投入）。
 */

export type OsmNode = {
  id: number;
  lat: number;
  lon: number;
};

export type OsmWay = {
  id: number;
  /** 構成ノードの ID 列。順序が道の形状を表す。 */
  nodes: number[];
  tags: Record<string, string>;
};

export type TileData = {
  ways: OsmWay[];
  nodes: OsmNode[];
};

/** highway 種別ごとの本数。取り込んだ結果の妥当性を目視で確かめるため。 */
export function countByHighway(ways: OsmWay[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const w of ways) {
    const h = w.tags.highway ?? "(none)";
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
