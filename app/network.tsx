import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { loadTiles, savedTiles } from "@/lib/db";
import {
  areConnected,
  buildGraph,
  edgeNode,
  largestComponentSize,
  neighbors,
} from "@/lib/graph";
import { countByHighway, TileData } from "@/lib/osm";
import { openStore } from "@/lib/store";
import { TileId, tileAt, tileKey, tilesAround } from "@/lib/tiles";

/** 開発時の初期エリア。docs/design.md#21-タイルの定義 */
const DEV = { lat: 35.62, lon: 139.7 };

/**
 * 端末内の道路網を確認する画面。
 *
 * 取得はしない。データを入れるのは Geofabrik からの一括投入で、
 * この画面は入ったものを見るだけ（docs/design.md#0-全体構成）。
 */
export default function Network() {
  const router = useRouter();
  const [data, setData] = useState<TileData | null>(null);
  const [stored, setStored] = useState<TileId[]>([]);
  const [totalTiles, setTotalTiles] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graph = useMemo(() => (data ? buildGraph(data) : null), [data]);

  const stats = useMemo(() => {
    if (!graph || graph.nodes.size === 0) return null;
    const totalM = graph.edges.reduce((sum, e) => sum + e.length, 0);
    const isolated = [...graph.nodes.keys()].filter(
      (id) => neighbors(graph, id).length === 0,
    ).length;

    // 保存済みタイルの西端と東端が繋がっているか
    const sorted = [...stored].sort((a, b) => a.x - b.x);
    const west = sorted.length > 0 ? edgeNode(graph, sorted[0], "west") : undefined;
    const east =
      sorted.length > 1
        ? edgeNode(graph, sorted[sorted.length - 1], "east")
        : undefined;

    return {
      totalKm: totalM / 1000,
      averageM: totalM / graph.edges.length,
      isolated,
      largest: largestComponentSize(graph),
      crossesTiles:
        west !== undefined && east !== undefined
          ? areConnected(graph, west, east)
          : undefined,
    };
  }, [graph, stored]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const db = await openStore();
      // 保存済みタイルの枚数だけ数える。関東全域だと 8,000 枚を超えるので、
      // 読み込むのは開発エリアの周り 3×3 に絞る。
      // 全部を一度に読むとグラフがメモリに載らない
      setTotalTiles((await savedTiles(db)).length);

      const tiles = tilesAround(tileAt(DEV.lat, DEV.lon), 1);
      setStored(tiles);
      setData(await loadTiles(db, tiles));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>端末内の道路網</Text>
      <Text style={styles.lead}>
        取得はしない。データは Geofabrik から一括で入れる。
      </Text>

      <View style={styles.card}>
        <Row label="端末内のタイル" value={totalTiles.toLocaleString()} />
        <Row label="読み込んだ範囲" value={`${stored.map(tileKey).join(", ")}`} />
      </View>

      <Pressable
        style={[styles.button, styles.buttonSecondary, busy && styles.buttonDisabled]}
        onPress={load}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#0a7ea4" />
        ) : (
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
            読み込み直す
          </Text>
        )}
      </Pressable>

      {error && (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {data && data.ways.length === 0 && !busy && (
        <View style={styles.card}>
          <Text style={styles.empty}>
            道路網がまだ入っていない。Geofabrik からの投入で入る。
          </Text>
        </View>
      )}

      {graph && stats && data && (
        <>
          <View style={styles.card}>
            <Row label="way" value={data.ways.length.toLocaleString()} />
            <Row label="node" value={data.nodes.length.toLocaleString()} />
          </View>

          <Text style={styles.subheading}>グラフ</Text>
          <View style={styles.card}>
            <Row label="交差点ノード" value={graph.nodes.size.toLocaleString()} />
            <Row label="エッジ" value={graph.edges.length.toLocaleString()} />
            <Row label="総延長" value={`${stats.totalKm.toFixed(1)} km`} />
            <Row label="平均区間長" value={`${stats.averageM.toFixed(1)} m`} />
            <Row label="孤立ノード" value={String(stats.isolated)} />
            <Row
              label="最大の連結成分"
              value={`${stats.largest.toLocaleString()} / ${graph.nodes.size.toLocaleString()}`}
            />
            {stats.crossesTiles !== undefined && (
              <Row
                label="端から端まで辿れる"
                value={stats.crossesTiles ? "はい" : "いいえ"}
              />
            )}
          </View>

          <Text style={styles.subheading}>highway 種別</Text>
          <View style={styles.card}>
            {countByHighway(data.ways).map(([type, count]) => (
              <Row key={type} label={type} value={String(count)} />
            ))}
          </View>
        </>
      )}


      <Pressable
        style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
        onPress={() => router.back()}
      >
        <Text style={styles.linkText}>地図に戻る</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 22, fontWeight: "600" },
  lead: { fontSize: 13, color: "#555" },
  subheading: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  empty: { color: "#666", paddingVertical: 12, textAlign: "center" },
  errorCard: { backgroundColor: "#ffe5e5" },
  errorText: { color: "#a00", paddingVertical: 10 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  rowLabel: { fontSize: 15, color: "#333" },
  rowValue: {
    flexShrink: 1,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
    textAlign: "right",
  },
  button: {
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonSecondary: { backgroundColor: "#fff" },
  buttonSecondaryText: { color: "#0a7ea4" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0a7ea4",
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 50,
  },
  linkRowPressed: { backgroundColor: "#e3f1f6" },
  linkText: { color: "#0a7ea4", fontSize: 16, fontWeight: "600" },
  linkChevron: { color: "#0a7ea4", fontSize: 22, fontWeight: "600" },
});
