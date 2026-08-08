import * as SQLite from "expo-sqlite";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Database } from "@/lib/db";
import {
  TARGET_BYTES,
  databaseBytes,
  growProbe,
  initProbe,
  probeQuery,
} from "@/lib/probe";

/**
 * Step 1-4: Expo Go が 900MB の DB を扱えるか確かめる。
 * 使い捨てなので、確認したら「削除」で消すこと。
 */
const PROBE_DB = "probe.db";

const MB = 1024 * 1024;
const format = (bytes: number) => `${(bytes / MB).toFixed(0)} MB`;

export default function Probe() {
  const [bytes, setBytes] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState<"膨張" | "クエリ" | "削除" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const busy = running !== null;

  /** 開いた接続を持っておく。閉じないと deleteDatabaseAsync が失敗する。 */
  const handle = useRef<SQLite.SQLiteDatabase | null>(null);

  async function open(): Promise<Database> {
    if (!handle.current) {
      handle.current = await SQLite.openDatabaseAsync(PROBE_DB);
    }
    const db = handle.current as unknown as Database;
    await initProbe(db);
    return db;
  }

  async function close() {
    if (handle.current) {
      await handle.current.closeAsync();
      handle.current = null;
    }
  }

  async function run(label: "膨張" | "クエリ" | "削除", fn: () => Promise<void>) {
    setRunning(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  const grow = () =>
    run("膨張", async () => {
      stop.current = false;
      setResult(null);
      const db = await open();
      await growProbe(db, TARGET_BYTES, (size) => {
        setBytes(size);
        return !stop.current;
      });
      setBytes(await databaseBytes(db));
    });

  const query = () =>
    run("クエリ", async () => {
      const db = await open();
      const started = Date.now();
      const { rows, sampleBytes } = await probeQuery(db);
      const elapsed = Date.now() - started;
      setBytes(await databaseBytes(db));
      setResult(`${rows} 行 / 末尾の行 ${format(sampleBytes)} / ${elapsed}ms`);
    });

  const remove = () =>
    run("削除", async () => {
      // 開いたままだと削除できない
      await close();
      await SQLite.deleteDatabaseAsync(PROBE_DB);
      setBytes(0);
      setResult(null);
    });

  const done = bytes >= TARGET_BYTES;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Step 1-4: 900MB の DB を試す</Text>
      <Text style={styles.lead}>
        F-10 は約 900MB の DB を端末に置く。Expo Go で扱えなければ
        ネイティブビルドが必要になり、macOS のアップグレードか年 $99 がかかる。
        ここで作るのはサイズを再現するだけの使い捨てで、実データではない。
      </Text>

      <View style={styles.card}>
        <Row label="現在のサイズ" value={format(bytes)} />
        <Row label="目標" value={format(TARGET_BYTES)} />
        <Row label="到達" value={done ? "はい" : "いいえ"} />
        {result && <Row label="クエリ結果" value={result} />}
      </View>

      <View style={styles.bar}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(100, (bytes / TARGET_BYTES) * 100)}%` },
          ]}
        />
      </View>

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={grow}
        disabled={busy}
      >
        {running === "膨張" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>900MB まで膨らませる</Text>
        )}
      </Pressable>

      {running === "膨張" && (
        <Pressable style={[styles.button, styles.stop]} onPress={() => (stop.current = true)}>
          <Text style={styles.buttonText}>中断</Text>
        </Pressable>
      )}

      <Pressable
        style={[styles.button, styles.secondary, busy && styles.buttonDisabled]}
        onPress={query}
        disabled={busy}
      >
        {running === "クエリ" ? (
          <ActivityIndicator color="#0a7ea4" />
        ) : (
          <Text style={[styles.buttonText, styles.secondaryText]}>開いてクエリする</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.button, styles.danger, busy && styles.buttonDisabled]}
        onPress={remove}
        disabled={busy}
      >
        {running === "削除" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>削除する</Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        中身は randomblob（無意味なランダムデータ）。関東 7 県のデータではない。
        確認が済んだら必ず削除すること。
      </Text>

      {error && (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 22, fontWeight: "600" },
  lead: { fontSize: 13, color: "#555", lineHeight: 19 },
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
  bar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#dcdce1",
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: "#0a7ea4" },
  button: {
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  secondary: { backgroundColor: "#fff" },
  secondaryText: { color: "#0a7ea4" },
  danger: { backgroundColor: "#c0392b" },
  stop: { backgroundColor: "#8a8a8e" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  note: { fontSize: 12, color: "#888", textAlign: "center" },
});
