import { TileId, tileBounds } from "./tiles";

/**
 * Overpass API から徒歩通行可能な道路を 1 タイル分取得する。
 *
 * 取得形式は `out body; >; out skel qt;`。ノード ID が返るので、
 * 隣接タイルとの接続を座標の浮動小数比較ではなく ID で判定できる。
 * docs/design.md#22-タイル間の接続
 *
 * Overpass は公共の無料サービス。開発中に何度も叩かないこと。
 */
const ENDPOINT = "https://overpass-api.de/api/interpreter";

/** 歩行者が通れない道は最初から除外する。docs/design.md#13-コストモデル */
const EXCLUDED_HIGHWAY = "^(motorway|trunk|motorway_link|trunk_link|construction|proposed)$";

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

function buildQuery(tile: TileId): string {
  const b = tileBounds(tile);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `
[out:json][timeout:180];
way["highway"]["highway"!~"${EXCLUDED_HIGHWAY}"]["foot"!="no"]["access"!="private"](${bbox});
out body;
>;
out skel qt;
`.trim();
}

export async function fetchTile(tile: TileId): Promise<TileData> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(buildQuery(tile))}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { elements: any[] };

  const ways: OsmWay[] = [];
  const nodes: OsmNode[] = [];
  for (const el of json.elements) {
    if (el.type === "way") {
      ways.push({ id: el.id, nodes: el.nodes, tags: el.tags ?? {} });
    } else if (el.type === "node") {
      nodes.push({ id: el.id, lat: el.lat, lon: el.lon });
    }
  }
  return { ways, nodes };
}

/** highway 種別ごとの本数。取得結果の妥当性を目視で確かめるため。 */
export function countByHighway(ways: OsmWay[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const w of ways) {
    const h = w.tags.highway ?? "(none)";
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
