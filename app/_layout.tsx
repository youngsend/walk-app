import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      {/* 地図はヘッダーを出さず、画面いっぱいに使う。
          戻る導線は下のパネルにある */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* 道路網と投入はヘッダーの戻るをそのまま使う */}
    </Stack>
  );
}
