import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { MapPressEvent, Marker, Polyline } from "react-native-maps";

import { LatLon } from "@/lib/graph";
import { PlanResult, planRoute } from "@/lib/plan";
import { Region, regionAround } from "@/lib/region";
import { openStore } from "@/lib/store";

/**
 * 地図・現在地・ルート提案。docs/development-plan.md の Step 4 と Step 5
 *
 * 地図は Apple Maps（iOS では provider を指定しなければこれになる）。
 * 経路探索に使う道路網は画面に描かれない（docs/design.md#22-画面の地図とは別のデータ）。
 */

/** 現在地が取れないときに見せる範囲。武蔵小山付近 */
const FALLBACK = regionAround(35.62, 139.7, 800);

type Status = "確認中" | "許可" | "拒否" | "失敗";

export default function Index() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("確認中");
  const [region, setRegion] = useState<Region>(FALLBACK);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [destination, setDestination] = useState<LatLon | null>(null);
  /** 出発地。null なら現在地を使う */
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [tapTarget, setTapTarget] = useState<"目的地" | "出発地">("目的地");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [searching, setSearching] = useState(false);
  // 既定は畳む。地図をできるだけ広く見せる
  const [open, setOpen] = useState(false);
  /** 下のパネルの高さ。地図をそのぶん下げるのに使う */
  const [panelHeight, setPanelHeight] = useState(0);

  const locate = useCallback(async () => {
    setStatus("確認中");
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus("拒否");
        setMessage(
          permission.canAskAgain
            ? "位置情報の許可がないと現在地を出せない。"
            : "設定アプリから位置情報を許可すると現在地が出る。",
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = position.coords;
      setHere({ lat: latitude, lon: longitude });
      setRegion(regionAround(latitude, longitude, 500));
      setStatus("許可");
    } catch (e) {
      setStatus("失敗");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  /** 実際の出発地。指定が無ければ現在地 */
  const start = origin ?? here;

  const propose = useCallback(async (from: LatLon, to: LatLon) => {
    setPlan(null);
    setSearching(true);
    try {
      const db = await openStore();
      setPlan(await planRoute(db, from, to));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  /**
   * 地図をタップした地点を、出発地か目的地に設定する。F-4
   *
   * 気になるスポットをタップしてそのまま行き先にできる。
   * Apple Maps では POI の名前は取れない（onPoiClick は Google Maps 限定）が、
   * 座標が取れれば目的地としては足りる。
   */
  const onMapPress = useCallback(
    (event: MapPressEvent) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      const point = { lat: latitude, lon: longitude };

      if (tapTarget === "出発地") {
        setOrigin(point);
        setTapTarget("目的地");
        if (destination) propose(point, destination);
        return;
      }

      setDestination(point);
      if (!start) {
        setMessage("現在地が分からない。出発地を指定するか、位置情報を許可する。");
        return;
      }
      propose(start, point);
    },
    [destination, propose, start, tapTarget],
  );

  const clear = useCallback(() => {
    setDestination(null);
    setOrigin(null);
    setTapTarget("目的地");
    setPlan(null);
  }, []);

  return (
    <View style={styles.screen}>
      <MapView
        style={styles.map}
        region={region}
        showsUserLocation={status === "許可"}
        onPress={onMapPress}
        // パネルのぶん地図を下げる。ピンや線がパネルの裏に隠れないようにする
        mapPadding={{ top: 0, right: 0, bottom: panelHeight, left: 0 }}
      >
        {here && (
          <Marker coordinate={{ latitude: here.lat, longitude: here.lon }} title="現在地" />
        )}
        {origin && (
          <Marker
            coordinate={{ latitude: origin.lat, longitude: origin.lon }}
            title="出発地"
            pinColor="#2e9e4f"
          />
        )}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lon }}
            title="目的地"
            pinColor="#0a7ea4"
          />
        )}
        {plan?.ok && (
          <Polyline
            coordinates={plan.coordinates.map((c) => ({
              latitude: c.lat,
              longitude: c.lon,
            }))}
            strokeColor="#0a7ea4"
            strokeWidth={5}
          />
        )}
      </MapView>

      {/* 地図を隠さないよう、操作と結果は下の 1 枚にまとめてある。
          畳めば地図が全部見える */}
      <View
        style={styles.panel}
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      >
        <Pressable style={styles.handle} onPress={() => setOpen(!open)}>
          <Text style={styles.handleText}>
            {searching
              ? "経路を探索中…"
              : plan?.ok
                ? `${(plan.distanceM / 1000).toFixed(2)} km・約 ${plan.minutes} 分`
                : plan && !plan.ok
                  ? plan.reason === "道路網なし"
                    ? "道路網が入っていない"
                    : "経路が見つからない"
                  : status === "確認中"
                    ? "現在地を取得中…"
                    : `地図をタップして${tapTarget}を決める`}
          </Text>
          <Text style={styles.chevron}>{open ? "▼" : "▲"}</Text>
        </Pressable>

        {open && (
          <View style={styles.body}>
            {plan?.ok && !searching && (
              <Text style={styles.dim}>
                {plan.breakdown
                  .slice(0, 3)
                  .map(([type, m]) => `${type} ${((m / plan.distanceM) * 100).toFixed(0)}%`)
                  .join(" / ")}
                {"  ·  "}
                {plan.tileCount}枚 / 読{plan.timings.loadMs} 構{plan.timings.buildMs} 探
                {plan.timings.searchMs}ms
              </Text>
            )}

            {plan && !plan.ok && !searching && (
              <Text style={styles.dim}>
                {plan.reason === "道路網なし"
                  ? "この辺りの道路網が入っていない。「投入」から入れる。"
                  : "川や線路で分断されているかもしれない。"}
              </Text>
            )}

            {(status === "拒否" || status === "失敗") && message && (
              <Text style={styles.dim}>{message}</Text>
            )}

            <View style={styles.row}>
              <Pressable
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={() => setTapTarget(tapTarget === "目的地" ? "出発地" : "目的地")}
              >
                <Text style={styles.chipText}>
                  タップ先<Text style={styles.strong}>{tapTarget}</Text>
                </Text>
              </Pressable>
              {origin && (
                <Pressable
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                  onPress={() => {
                    setOrigin(null);
                    if (destination && here) propose(here, destination);
                  }}
                >
                  <Text style={styles.chipText}>現在地から</Text>
                </Pressable>
              )}
              {(plan || destination) && (
                <Pressable
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                  onPress={clear}
                >
                  <Text style={styles.chipText}>消す</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={locate}
              >
                <Text style={styles.chipText}>現在地へ</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={() => router.push("/network")}
              >
                <Text style={styles.chipText}>道路網</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={() => router.push("/transfer")}
              >
                <Text style={styles.chipText}>投入</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    // ホームインジケータぶんだけ空ける
    paddingBottom: 22,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -1 },
  },
  handle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 7,
    paddingBottom: 7,
  },
  handleText: { flex: 1, fontSize: 14, fontWeight: "600", color: "#222" },
  chevron: { fontSize: 10, color: "#999" },
  body: { paddingHorizontal: 14, paddingBottom: 4, gap: 8 },
  dim: { fontSize: 11, color: "#888" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: "#eef6f9",
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: 12, color: "#0a7ea4" },
  strong: { fontWeight: "700" },
  pressed: { opacity: 0.6 },
});
