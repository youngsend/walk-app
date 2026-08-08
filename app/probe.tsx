import { Directory, File } from "expo-file-system";
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
import { createProbeStore, ProbeFiles, ProbeSqlite } from "@/lib/probe-store";

/**
 * Step 1-4: Expo Go が 900MB の DB を扱えるか確かめる。
 * 使い捨てなので、確認したら「削除」で消すこと。
 */
const PROBE_DB = "probe.db";

const MB = 1024 * 1024;
const format = (bytes: number) => `${(bytes / MB).toFixed(0)} MB`;

type DiskEntry = { name: string; bytes: number };

/** SQLite のディレクトリに実際に置かれているファイルを見る。 */
function inspectDisk(): DiskEntry[] {
  const dir = new Directory(SQLite.defaultDatabaseDirectory);
  if (!dir.exists) return [];
  return dir
    .list()
    .map((entry) => ({
      name: decodeURIComponent(entry.uri.split("/").pop() ?? entry.uri),
      bytes: entry instanceof File ? entry.size : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** expo-sqlite が消しきれなかったときの、ファイル直接削除。 */
const probeFiles: ProbeFiles = {
  list: () => inspectDisk().map((e) => e.name),
  delete: (name) => new File(SQLite.defaultDatabaseDirectory, name).delete(),
};

export default function Probe() {
  const [disk, setDisk] = useState<DiskEntry[]>([]);
  const [bytes, setBytes] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState<"膨張" | "クエリ" | "削除" | "確認" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const busy = running !== null;

  /** 開閉と削除の順序は lib/probe-store.ts が持つ（テスト済み）。 */
  const store = useRef(
    createProbeStore(SQLite as unknown as ProbeSqlite, PROBE_DB, probeFiles),
  );

  async function open(): Promise<Database> {
    const db = await store.current.open();
    await initProbe(db);
    return db;
  }

  async function run(
    label: "膨張" | "クエリ" | "削除" | "確認",
    fn: () => Promise<void>,
  ) {
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
      const report = await store.current.remove();
      setBytes(0);
      setResult(null);
      setDisk(inspectDisk());

      if (report.remaining.length > 0) {
        setError(
          `消せなかった: ${report.remaining.join(", ")}` +
            (report.error ? `\n${report.error}` : ""),
        );
      } else if (report.forceDeleted.length > 0) {
        setResult(`ファイルを直接削除: ${report.forceDeleted.join(", ")}`);
      }
    });

  const inspect = () =>
    run("確認", async () => {
      setDisk(inspectDisk());
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

      <Pressable
        style={[styles.button, styles.secondary, busy && styles.buttonDisabled]}
        onPress={inspect}
        disabled={busy}
      >
        {running === "確認" ? (
          <ActivityIndicator color="#0a7ea4" />
        ) : (
          <Text style={[styles.buttonText, styles.secondaryText]}>
            実ファイルを確認する
          </Text>
        )}
      </Pressable>

      {disk.length > 0 && (
        <View style={styles.card}>
          {disk.map((entry) => (
            <Row
              key={entry.name}
              label={entry.name}
              value={entry.bytes >= MB ? format(entry.bytes) : `${entry.bytes} B`}
            />
          ))}
        </View>
      )}

      <Text style={styles.note}>
        中身は randomblob（無意味なランダムデータ）。関東 7 県のデータではない。
        確認が済んだら必ず削除すること。probe.db が一覧から消えていれば削除できている。
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
