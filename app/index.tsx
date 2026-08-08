import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { countByHighway, fetchTile, TileData } from "@/lib/overpass";
import { tileAt, tileBounds, tileKey } from "@/lib/tiles";

/** 開発時の初期エリア: 武蔵小山付近（品川区・目黒区の境界）。docs/design.md#21-タイルの定義 */
const DEV_LAT = 35.62;
const DEV_LON = 139.7;

export default function Index() {
  const [data, setData] = useState<TileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tile = tileAt(DEV_LAT, DEV_LON);
  const bounds = tileBounds(tile);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchTile(tile));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Step 1-1: タイル取得</Text>

      <View style={styles.card}>
        <Row label="タイル" value={tileKey(tile)} />
        <Row label="南西" value={`${bounds.south.toFixed(2)}, ${bounds.west.toFixed(2)}`} />
        <Row label="北東" value={`${bounds.north.toFixed(2)}, ${bounds.east.toFixed(2)}`} />
      </View>

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={load}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Overpass から取得</Text>
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
        <>
          <View style={styles.card}>
            <Row label="way" value={data.ways.length.toLocaleString()} expected="1,806" />
            <Row label="node" value={data.nodes.length.toLocaleString()} expected="6,391" />
          </View>

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
      <Text style={styles.rowValue}>
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
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  rowLabel: { fontSize: 15, color: "#333" },
  rowValue: { fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "500" },
  rowExpected: { fontWeight: "400", color: "#888" },
  button: {
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  note: { fontSize: 12, color: "#888", textAlign: "center" },
});
