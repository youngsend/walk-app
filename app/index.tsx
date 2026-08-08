import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { Region, regionAround } from "@/lib/region";

/**
 * 地図と現在地。docs/development-plan.md の Step 4
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

  return (
    <View style={styles.screen}>
      <MapView style={styles.map} region={region} showsUserLocation={status === "許可"}>
        {here && (
          <Marker coordinate={{ latitude: here.lat, longitude: here.lon }} title="現在地" />
        )}
      </MapView>

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
