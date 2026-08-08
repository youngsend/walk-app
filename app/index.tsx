import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { hasTile, loadTiles, savedTiles, saveTile } from "@/lib/db";
import { buildGraph, neighbors } from "@/lib/graph";
import { countByHighway, fetchTile, TileData } from "@/lib/overpass";
import { openStore } from "@/lib/store";
import { tileAt, tileBounds, TileId, tileKey } from "@/lib/tiles";

/** 開発時の初期エリア: 武蔵小山付近（品川区・目黒区の境界）。docs/design.md#21-タイルの定義 */
const DEV_LAT = 35.62;
const DEV_LON = 139.7;

type Source = "取得" | "保存済み" | null;

/** 実行中の操作。押されたボタンにだけスピナーを出すために持つ。 */
type Running = "起動" | "取得" | "読み込み" | null;

export default function Index() {
  const [data, setData] = useState<TileData | null>(null);
  const [source, setSource] = useState<Source>(null);
  const [stored, setStored] = useState<TileId[]>([]);
  const [running, setRunning] = useState<Running>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = running !== null;

  const tile = useMemo(() => tileAt(DEV_LAT, DEV_LON), []);
  const bounds = tileBounds(tile);

  const graph = useMemo(() => (data ? buildGraph(data) : null), [data]);

  const stats = useMemo(() => {
    if (!graph) return null;
    const totalM = graph.edges.reduce((sum, e) => sum + e.length, 0);
    const isolated = [...graph.nodes.keys()].filter(
      (id) => neighbors(graph, id).length === 0,
    ).length;
    const sample = [...graph.nodes.keys()].find(
      (id) => neighbors(graph, id).length >= 3,
    );
    return {
      totalKm: totalM / 1000,
      averageM: totalM / graph.edges.length,
      isolated,
      sample,
      sampleNeighbors: sample ? neighbors(graph, sample) : [],
    };
  }, [graph]);

  const run = useCallback(
    async (label: Exclude<Running, null>, fn: () => Promise<void>) => {
      setRunning(label);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(null);
      }
    },
    [],
  );

  /** 起動時に、保存済みなら通信せずに復元する。1-3 の完了の定義。 */
  useEffect(() => {
    run("起動", async () => {
      const db = await openStore();
      setStored(await savedTiles(db));
      if (await hasTile(db, tile)) {
        setData(await loadTiles(db, [tile]));
        setSource("保存済み");
      }
    });
  }, [run, tile]);

  const download = () =>
    run("取得", async () => {
      const db = await openStore();
      const fetched = await fetchTile(tile);
      await saveTile(db, tile, fetched);
      setData(fetched);
      setSource("取得");
      setStored(await savedTiles(db));
    });

  const reloadFromStore = () =>
    run("読み込み", async () => {
      const db = await openStore();
      setData(await loadTiles(db, [tile]));
      setSource("保存済み");
    });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Step 1: 道路網とグラフ</Text>

      <View style={styles.card}>
        <Row label="タイル" value={tileKey(tile)} />
        <Row label="南西" value={`${bounds.south}, ${bounds.west}`} />
        <Row label="北東" value={`${bounds.north}, ${bounds.east}`} />
        <Row label="保存済みタイル" value={stored.map(tileKey).join(", ") || "なし"} />
        <Row label="表示中のデータ" value={source ?? "なし"} />
      </View>

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={download}
        disabled={busy}
      >
        {running === "取得" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Overpass から取得して保存</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.button, styles.buttonSecondary, busy && styles.buttonDisabled]}
        onPress={reloadFromStore}
        disabled={busy}
      >
        {running === "読み込み" ? (
          <ActivityIndicator color="#0a7ea4" />
        ) : (
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
            保存済みから読み込む（通信なし）
          </Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        Overpass は公共の無料サービス。何度も叩かないこと。
      </Text>

      {error && (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {data && (
        <View style={styles.card}>
          <Row label="way" value={data.ways.length.toLocaleString()} expected="1,806" />
          <Row label="node" value={data.nodes.length.toLocaleString()} expected="6,391" />
        </View>
      )}

      {graph && stats && (
        <>
          <Text style={styles.subheading}>グラフ</Text>
          <View style={styles.card}>
            <Row
              label="交差点ノード"
              value={graph.nodes.size.toLocaleString()}
              expected="2,767"
            />
            <Row
              label="エッジ"
              value={graph.edges.length.toLocaleString()}
              expected="3,777"
            />
            <Row label="総延長" value={`${stats.totalKm.toFixed(1)} km`} expected="162.9 km" />
            <Row label="平均区間長" value={`${stats.averageM.toFixed(1)} m`} />
            <Row label="孤立ノード" value={String(stats.isolated)} expected="0" />
          </View>

          <Text style={styles.subheading}>隣接ノードの列挙</Text>
          <View style={styles.card}>
            <Row label="node" value={String(stats.sample ?? "-")} />
            <Row label="接続先" value={stats.sampleNeighbors.join(", ") || "-"} />
          </View>
        </>
      )}

      {data && (
        <>
          <Text style={styles.subheading}>highway 種別</Text>
          <View style={styles.card}>
            {countByHighway(data.ways).map(([type, count]) => (
              <Row key={type} label={type} value={String(count)} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  expected,
}: {
  label: string;
  value: string;
  expected?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
        {expected && <Text style={styles.rowExpected}>{`  (実測 ${expected})`}</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 22, fontWeight: "600" },
  subheading: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
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
  rowExpected: { fontWeight: "400", color: "#888" },
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
  note: { fontSize: 12, color: "#888", textAlign: "center" },
});
