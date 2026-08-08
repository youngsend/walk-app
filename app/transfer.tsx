import { Directory, File, Paths } from "expo-file-system";
import * as Legacy from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as SQLite from "expo-sqlite";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { savedTiles } from "@/lib/db";
import {
  DB_FILE_NAME,
  SPACE_MARGIN_BYTES,
  checkSpace,
  databaseFileUri,
  dbUrl,
} from "@/lib/transfer";
import { closeStore, openStore } from "@/lib/store";

/**
 * 関東全域の道路網を自宅 Wi-Fi 経由で端末に入れる。
 * docs/development-plan.md の Step 3-3 / docs/requirements.md#f-10
 *
 * Mac 側で `npx tsx scripts/serve-db.ts ~/Downloads/walk.db` を立てて、
 * 表示された IP をここに入れる。
 *
 * 判断（空きが足りるか・URL の組み立て）は lib/transfer.ts にあり、
 * そちらは実機なしでテストしてある。ここは通信とファイル操作だけ。
 */

const PORT = 8080;
const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(0)} MB`;

type Phase = "待機" | "確認中" | "転送中" | "確かめ中" | "完了" | "失敗";

export default function Transfer() {
  const router = useRouter();
  const [host, setHost] = useState("");
  const [phase, setPhase] = useState<Phase>("待機");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const say = useCallback((line: string) => setLog((prev) => [...prev, line]), []);

  /** 転送先。expo-sqlite が読む場所に直接置く（あとで移動しない） */
  const destination = useCallback(() => {
    const directory = String(SQLite.defaultDatabaseDirectory);
    return {
      directory,
      uri: databaseFileUri(directory, DB_FILE_NAME),
    };
  }, []);

  /** 大きさを聞いて、空き容量と突き合わせる。F-10 の「足りなければ開始しない」 */
  const check = useCallback(async () => {
    setPhase("確認中");
    setLog([]);
    try {
      const url = dbUrl(host, PORT);
      say(`取得先 ${url}`);

      const head = await fetch(url, { method: "HEAD" });
      if (!head.ok) throw new Error(`HEAD が ${head.status} を返した`);
      const needed = Number(head.headers.get("content-length") ?? 0);
      say(`DB の大きさ ${needed > 0 ? mb(needed) : "不明"}`);

      const { directory, uri } = destination();
      say(`置き場所 ${directory}`);

      // 入れ替えなら、いま置いてある DB のぶんは空きとして数えてよい
      const existing = new File(uri);
      const replacing = existing.exists ? existing.size : 0;
      if (replacing > 0) say(`いま入っている DB ${mb(replacing)}（消してから入れる）`);

      const available = Paths.availableDiskSpace;
      say(`端末の空き ${mb(available)}（余白 ${mb(SPACE_MARGIN_BYTES)} を残す）`);

      const result = checkSpace({ needed, available, replacing });
      if (!result.ok) {
        setPhase("失敗");
        say(`空きが足りない。あと ${mb(result.shortfall)} 空ける`);
        return null;
      }
      say("空きは足りている");
      setPhase("待機");
      return { url, uri, needed };
    } catch (e) {
      setPhase("失敗");
      say(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [destination, host, say]);

  const start = useCallback(async () => {
    const plan = await check();
    if (!plan) return;

    setPhase("転送中");
    setProgress(0);
    try {
      // 開いたままのファイルは消せない。先に接続を手放す
      await closeStore();

      const directory = new Directory(String(SQLite.defaultDatabaseDirectory));
      if (!directory.exists) directory.create({ intermediates: true });

      // WAL の付随ファイルごと消す。古い DB の断片が残ると開けなくなる
      for (const name of [DB_FILE_NAME, `${DB_FILE_NAME}-wal`, `${DB_FILE_NAME}-shm`]) {
        const file = new File(databaseFileUri(String(SQLite.defaultDatabaseDirectory), name));
        if (file.exists) {
          file.delete();
          say(`消した ${name}`);
        }
      }

      // 進捗を出すため legacy を使う。新しい File.downloadFileAsync は
      // 進捗を返さず、670MB を無言で待つことになる
      const task = Legacy.createDownloadResumable(
        plan.url,
        plan.uri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : plan.needed;
          setProgress(total > 0 ? totalBytesWritten / total : 0);
        },
      );

      const started = Date.now();
      const result = await task.downloadAsync();
      if (!result) throw new Error("転送が中断された");

      const seconds = (Date.now() - started) / 1000;
      const written = new File(plan.uri);
      say(`転送おわり ${mb(written.size)} / ${seconds.toFixed(0)}s`);

      if (written.size !== plan.needed) {
        throw new Error(
          `大きさが合わない（期待 ${mb(plan.needed)} / 実際 ${mb(written.size)}）`,
        );
      }

      // 置けただけでは足りない。expo-sqlite が読めるかを確かめる
      setPhase("確かめ中");
      const db = await openStore();
      const tiles = await savedTiles(db);
      const ways = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM ways");
      const nodes = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM nodes");
      say(`タイル ${tiles.length.toLocaleString()}`);
      say(`way ${(ways?.n ?? 0).toLocaleString()}`);
      say(`node ${(nodes?.n ?? 0).toLocaleString()}`);

      setPhase("完了");
    } catch (e) {
      setPhase("失敗");
      say(e instanceof Error ? e.message : String(e));
    }
  }, [check, say]);

  const busy = phase === "確認中" || phase === "転送中" || phase === "確かめ中";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>道路網を入れる</Text>
      <Text style={styles.lead}>
        Mac で {"`npx tsx scripts/serve-db.ts ~/Downloads/walk.db`"} を立て、
        表示された IP を入れる。同じ Wi-Fi にいること。
      </Text>

      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        placeholder="192.168.1.5"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
      />

      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.secondary, busy && styles.disabled]}
          onPress={check}
          disabled={busy || host.trim() === ""}
        >
          <Text style={[styles.buttonText, styles.secondaryText]}>空きを確かめる</Text>
        </Pressable>
        <Pressable
          style={[styles.button, busy && styles.disabled]}
          onPress={start}
          disabled={busy || host.trim() === ""}
        >
          <Text style={styles.buttonText}>転送する</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.statusRow}>
          {busy && <ActivityIndicator color="#0a7ea4" />}
          <Text style={styles.status}>{phase}</Text>
          {phase === "転送中" && (
            <Text style={styles.percent}>{(progress * 100).toFixed(1)}%</Text>
          )}
        </View>
        {phase === "転送中" && (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
          </View>
        )}
      </View>

      {log.length > 0 && (
        <View style={styles.card}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      )}

      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => router.push("/network")}
      >
        <Text style={[styles.buttonText, styles.secondaryText]}>道路網を見る</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: "700", color: "#222" },
  lead: { fontSize: 13, color: "#666", lineHeight: 19 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  row: { flexDirection: "row", gap: 10 },
  button: {
    flex: 1,
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#0a7ea4" },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryText: { color: "#0a7ea4" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, gap: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  status: { fontSize: 16, fontWeight: "600", color: "#222", flex: 1 },
  percent: { fontSize: 16, fontWeight: "700", color: "#0a7ea4" },
  bar: { height: 8, backgroundColor: "#e5e5e5", borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: "#0a7ea4" },
  logLine: { fontSize: 13, color: "#444", fontFamily: "Menlo" },
});
