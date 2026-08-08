import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [searching, setSearching] = useState(false);

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

  /** 地図をタップした地点まで経路を引く。F-4 */
  const propose = useCallback(
    async (to: LatLon) => {
      if (!here) {
        setMessage("現在地が分からないと経路を引けない。");
        return;
      }
      setDestination(to);
      setPlan(null);
      setSearching(true);
      try {
        const db = await openStore();
        setPlan(await planRoute(db, here, to));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setSearching(false);
      }
    },
    [here],
  );

  const onMapPress = useCallback(
    (event: MapPressEvent) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      propose({ lat: latitude, lon: longitude });
    },
    [propose],
  );

  const clear = useCallback(() => {
    setDestination(null);
    setPlan(null);
  }, []);

  return (
    <View style={styles.screen}>
      <MapView
        style={styles.map}
        region={region}
        showsUserLocation={status === "許可"}
        onPress={onMapPress}
      >
        {here && (
          <Marker coordinate={{ latitude: here.lat, longitude: here.lon }} title="現在地" />
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

      {searching && (
        <View style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayText}>経路を探索中</Text>
        </View>
      )}

      {plan && !plan.ok && !searching && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            {plan.reason === "道路網なし"
              ? "この辺りの道路網が入っていない。「投入」から入れる。"
              : "そこまでの経路が見つからない。川や線路で分断されているかもしれない。"}
          </Text>
        </View>
      )}

      {plan?.ok && !searching && (
        <View style={styles.result}>
          <Text style={styles.resultMain}>
            {(plan.distanceM / 1000).toFixed(2)} km・約 {plan.minutes} 分
          </Text>
          <Text style={styles.resultSub}>
            {plan.breakdown
              .slice(0, 3)
              .map(([type, m]) => `${type} ${((m / plan.distanceM) * 100).toFixed(0)}%`)
              .join(" / ")}
          </Text>
          <Text style={styles.resultSub}>
            タイル {plan.tileCount} 枚・読込 {plan.timings.loadMs}ms・構築{" "}
            {plan.timings.buildMs}ms・探索 {plan.timings.searchMs}ms
          </Text>
          <Pressable style={styles.retry} onPress={clear}>
            <Text style={styles.retryText}>消す</Text>
          </Pressable>
        </View>
      )}

      {status === "確認中" && (
        <View style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayText}>現在地を取得中</Text>
        </View>
      )}

      {(status === "拒否" || status === "失敗") && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{message}</Text>
          <Pressable style={styles.retry} onPress={locate}>
            <Text style={styles.retryText}>もう一度試す</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          onPress={locate}
        >
          <Text style={styles.linkText}>現在地へ</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          onPress={() => router.push("/network")}
        >
          <Text style={styles.linkText}>道路網</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          onPress={() => router.push("/transfer")}
        >
          <Text style={styles.linkText}>投入</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 10,
    padding: 14,
    gap: 10,
    alignItems: "center",
  },
  overlayText: { fontSize: 14, color: "#333", textAlign: "center" },
  result: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 10,
    padding: 14,
    gap: 6,
    alignItems: "center",
  },
  resultMain: { fontSize: 20, fontWeight: "700", color: "#222" },
  resultSub: { fontSize: 12, color: "#666", textAlign: "center" },
  retry: {
    backgroundColor: "#0a7ea4",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryText: { color: "#fff", fontWeight: "600" },
  footer: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 10,
  },
  link: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  linkPressed: { backgroundColor: "#e3f1f6" },
  linkText: { color: "#0a7ea4", fontSize: 16, fontWeight: "600" },
});
