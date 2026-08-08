/**
 * Geofabrik の PBF から、アプリが読む SQLite を作る。
 * docs/development-plan.md の Step 3-1 / 3-2
 *
 *   npx tsx scripts/build-db.ts <入力.osm.pbf> <出力.db>
 *
 * 関東 7 県で way 約 1,000 万本・node 約 3,700 万個になり、
 * JS のメモリには載らない。SQLite を作業場所にした 2 パスで処理する。
 *
 *   1 パス目: way を読み、歩ける道だけ ways に入れる。
 *             参照している node の ID を needed_nodes に控える。
 *             幹線は歩けなくても arterials に控える（歩道の判定に使う）
 *   2 パス目: node を読み、needed_nodes にあるものだけ nodes に入れる
 *   歩道判定 : 歩道が沿っている幹線の種別を空間的に求めて along に書く
 *   仕上げ  : way ごとに、構成ノードが入るタイルを way_tiles に書く
 *
 * 抽出の規則（isWalkable / tilesForNodes）はアプリと共有している。
 * 別々に書くと Step 1 の実測値と食い違ってしまう。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import osmParser from "osm-pbf-parser";

import { isWalkable, tilesForNodes } from "../lib/osm-filter";
import { ArterialIndex } from "../lib/sidepath";
import { tileAt } from "../lib/tiles";

type OsmItem = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  refs?: number[];
  tags?: Record<string, string>;
};

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("使い方: npx tsx scripts/build-db.ts <入力.osm.pbf> <出力.db>");
  process.exit(1);
}

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;

function log(message: string) {
  console.log(`[${elapsed()}] ${message}`);
}

if (fs.existsSync(output)) fs.unlinkSync(output);
const db = new DatabaseSync(output);

db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;

  CREATE TABLE tiles (x INTEGER NOT NULL, y INTEGER NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (x, y));
  CREATE TABLE nodes (id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL);
  CREATE TABLE ways (id INTEGER PRIMARY KEY, node_ids TEXT NOT NULL, highway TEXT NOT NULL, lanes REAL, footway TEXT, along TEXT);
  CREATE TABLE way_tiles (way_id INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, PRIMARY KEY (way_id, x, y));

  -- 作業用。最後に落とす
  CREATE TABLE needed_nodes (id INTEGER PRIMARY KEY);
  -- 幹線。歩けない trunk / motorway も含む。歩道が沿う相手を探すのに使う
  CREATE TABLE arterials (id INTEGER PRIMARY KEY, node_ids TEXT NOT NULL, highway TEXT NOT NULL);
  -- 名前つきの地点。タップした場所の名前を出すのに使う
  CREATE TABLE pois (x INTEGER NOT NULL, y INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL);
  -- 名前つきの面。重心を出すため、座標が揃うまで控えておく
  CREATE TABLE poi_ways (id INTEGER PRIMARY KEY, node_ids TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL);
`);

/** PBF を流して、種類ごとに渡す。 */
function readPbf(onItem: (item: OsmItem) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(input)
      .pipe(osmParser())
      .on("data", (items: OsmItem[]) => {
        for (const item of items) onItem(item);
      })
      .on("end", () => resolve())
      .on("error", reject);
  });
}

async function pass1CollectWays() {
  log("1 パス目: way を読む");
  const insertWay = db.prepare(
    "INSERT OR REPLACE INTO ways (id, node_ids, highway, lanes, footway) VALUES (?, ?, ?, ?, ?)",
  );
  const insertNeeded = db.prepare("INSERT OR IGNORE INTO needed_nodes (id) VALUES (?)");
  const insertArterial = db.prepare(
    "INSERT OR REPLACE INTO arterials (id, node_ids, highway) VALUES (?, ?, ?)",
  );
  const insertPoiWay = db.prepare(
    "INSERT OR REPLACE INTO poi_ways (id, node_ids, name, kind) VALUES (?, ?, ?, ?)",
  );

  let seen = 0;
  let kept = 0;
  let arterials = 0;
  db.exec("BEGIN");
  await readPbf((item) => {
    if (item.type !== "way") return;
    seen++;
    const tags = item.tags ?? {};
    const refs = item.refs ?? [];

    // 名前つきの面（公園・駅・施設）。重心を出すのは座標が揃ってから。
    // 公園は 30,041 件が面で描かれているので、点だけでは足りない
    if (refs.length >= 2 && !tags.highway) {
      const kind = poiKind(tags);
      if (kind) {
        insertPoiWay.run(item.id, JSON.stringify(refs), tags.name, kind);
        for (const ref of refs) insertNeeded.run(ref);
      }
    }

    // 幹線は歩けなくても控える。歩道がどの道路に沿っているかの判定に使う。
    // trunk は別線歩道の付与率が最も高い（7.0%）ので落とせない
    if (refs.length >= 2 && ARTERIAL_HIGHWAY.has(baseHighway(tags.highway ?? ""))) {
      insertArterial.run(item.id, JSON.stringify(refs), tags.highway);
      for (const ref of refs) insertNeeded.run(ref);
      arterials++;
    }

    if (!isWalkable(tags)) return;
    if (refs.length < 2) return;

    const lanes = parseFloat(tags.lanes);
    insertWay.run(
      item.id,
      JSON.stringify(refs),
      tags.highway,
      Number.isFinite(lanes) ? lanes : null,
      // 歩道・横断歩道を歩行者専用道と区別するため（design.md#111）
      tags.footway ?? null,
    );
    for (const ref of refs) insertNeeded.run(ref);
    kept++;

    if (kept % 500_000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      log(`  way ${kept.toLocaleString()} 本`);
    }
  });
  db.exec("COMMIT");
  log(
    `1 パス目おわり: ${seen.toLocaleString()} 本中 ${kept.toLocaleString()} 本を採用、幹線 ${arterials.toLocaleString()} 本を控えた`,
  );
}

async function pass2CollectNodes() {
  log("2 パス目: node を読む");
  const isNeeded = db.prepare("SELECT 1 FROM needed_nodes WHERE id = ?");
  const insertNode = db.prepare(
    "INSERT OR REPLACE INTO nodes (id, lat, lon) VALUES (?, ?, ?)",
  );
  const insertPoi = db.prepare(
    "INSERT INTO pois (x, y, lat, lon, name, kind) VALUES (?, ?, ?, ?, ?, ?)",
  );

  let seen = 0;
  let kept = 0;
  let pois = 0;
  db.exec("BEGIN");
  await readPbf((item) => {
    if (item.type !== "node") return;
    seen++;

    // 名前つきの点。道路に使われていなくても拾う
    const kind = poiKind(item.tags ?? {});
    if (kind) {
      const tile = tileAt(item.lat!, item.lon!);
      insertPoi.run(tile.x, tile.y, item.lat!, item.lon!, item.tags!.name, kind);
      pois++;
    }

    if (!isNeeded.get(item.id)) return;
    insertNode.run(item.id, item.lat!, item.lon!);
    kept++;

    if (kept % 1_000_000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      log(`  node ${kept.toLocaleString()} 個`);
    }
  });
  db.exec("COMMIT");
  log(
    `2 パス目おわり: ${seen.toLocaleString()} 個中 ${kept.toLocaleString()} 個を採用、名前つきの点 ${pois.toLocaleString()} 件`,
  );
}

/**
 * 歩行者専用の道が沿っている幹線の種別を求めて along に書く。
 *
 * OSM の歩道は親道路を記録していない（is_sidepath は関東で 0 件）ので、
 * 座標で調べるしかない（lib/sidepath.ts）。
 *
 * footway=sidewalk だけでなく **種別の無い footway・path・pedestrian・steps も**
 * 見る。footway の 39.4% は footway= が無く、公園の遊歩道と種別を書かれて
 * いない歩道が混ざっているため。横断歩道は除く（横断は避けようがない）。
 */
function markSidepaths() {
  log("歩道が沿う幹線を探す");
  const coordsOf = db.prepare("SELECT lat, lon FROM nodes WHERE id = ?");

  const index = new ArterialIndex();
  let indexed = 0;
  for (const row of db.prepare("SELECT node_ids, highway FROM arterials").iterate() as Iterable<{
    node_ids: string;
    highway: string;
  }>) {
    const coords = coordsFor(JSON.parse(row.node_ids), coordsOf);
    if (coords.length < 2) continue;
    index.add(row.highway, coords);
    indexed++;
  }
  log(`  幹線 ${indexed.toLocaleString()} 本を格子に入れた（セル ${index.size.toLocaleString()}）`);

  const update = db.prepare("UPDATE ways SET along = ? WHERE id = ?");
  const candidates = db.prepare(
    `SELECT id, node_ids, highway, footway FROM ways
      WHERE highway IN ('footway', 'path', 'pedestrian', 'steps')
        AND (footway IS NULL OR footway <> 'crossing')`,
  );

  const byClass = new Map<string, number>();
  const byHighway = new Map<string, number>();
  let done = 0;
  let matched = 0;
  db.exec("BEGIN");
  for (const row of candidates.iterate() as Iterable<{
    id: number;
    node_ids: string;
    highway: string;
  }>) {
    const coords = coordsFor(JSON.parse(row.node_ids), coordsOf);
    // 全長のうち幹線の近くを通る割合で判断する。
    // 1 点だけ見ると、幹線を横切る歩道橋まで「幹線沿い」になってしまう
    const best = index.classAlong(coords);
    if (best) {
      update.run(best, row.id);
      byClass.set(best, (byClass.get(best) ?? 0) + 1);
      byHighway.set(row.highway, (byHighway.get(row.highway) ?? 0) + 1);
      matched++;
    }
    done++;
    if (done % 50_000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      log(`  ${done.toLocaleString()} 本`);
    }
  }
  db.exec("COMMIT");

  log(
    `歩道おわり: ${done.toLocaleString()} 本中 ${matched.toLocaleString()} 本が幹線沿い（${((matched / done) * 100).toFixed(1)}%）`,
  );
  log("  沿っている幹線の格:");
  for (const [highway, count] of [...byClass].sort((a, b) => b[1] - a[1])) {
    log(`    ${highway.padEnd(10)} ${count.toLocaleString()}`);
  }
  log("  旗が立った道の種別:");
  for (const [highway, count] of [...byHighway].sort((a, b) => b[1] - a[1])) {
    log(`    ${highway.padEnd(10)} ${count.toLocaleString()}`);
  }
}

/**
 * 名前つきの地点として拾うタグ。**先に来たものを種別にする。**
 * place（町丁名）は店や公園が無いときの受け皿で、探す距離が違う（lib/poi.ts）。
 */
const POI_KEYS = [
  "amenity",
  "shop",
  "leisure",
  "tourism",
  "railway",
  "historic",
  "natural",
  "office",
  "place",
];

function poiKind(tags: Record<string, string>): string | undefined {
  if (!tags.name) return undefined;
  return POI_KEYS.find((k) => tags[k]);
}

const ARTERIAL_HIGHWAY = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);

function baseHighway(highway: string): string {
  return highway.endsWith("_link") ? highway.slice(0, -"_link".length) : highway;
}

/** node ID 列から座標列へ。1 つでも欠けたら、そこまでで返す。 */
function coordsFor(
  refs: number[],
  coordsOf: { get(id: number): unknown },
): { lat: number; lon: number }[] {
  const coords: { lat: number; lon: number }[] = [];
  for (const ref of refs) {
    const c = coordsOf.get(ref) as { lat: number; lon: number } | undefined;
    if (!c) break;
    coords.push(c);
  }
  return coords;
}

/** 名前つきの面を重心にして pois に入れる。公園や駅は面で描かれている。 */
function centroidPois() {
  log("名前つきの面を重心にする");
  const coordsOf = db.prepare("SELECT lat, lon FROM nodes WHERE id = ?");
  const insertPoi = db.prepare(
    "INSERT INTO pois (x, y, lat, lon, name, kind) VALUES (?, ?, ?, ?, ?, ?)",
  );

  let done = 0;
  let dropped = 0;
  db.exec("BEGIN");
  for (const row of db.prepare("SELECT node_ids, name, kind FROM poi_ways").iterate() as Iterable<{
    node_ids: string;
    name: string;
    kind: string;
  }>) {
    const coords = coordsFor(JSON.parse(row.node_ids), coordsOf);
    if (coords.length === 0) {
      dropped++;
      continue;
    }
    const lat = coords.reduce((a, c) => a + c.lat, 0) / coords.length;
    const lon = coords.reduce((a, c) => a + c.lon, 0) / coords.length;
    const tile = tileAt(lat, lon);
    insertPoi.run(tile.x, tile.y, lat, lon, row.name, row.kind);
    done++;
  }
  db.exec("COMMIT");
  log(`面おわり: ${done.toLocaleString()} 件（座標が揃わず落としたのが ${dropped.toLocaleString()} 件）`);
}

function assignTiles() {
  log("way をタイルに振り分ける");
  const insertTile = db.prepare(
    "INSERT OR IGNORE INTO way_tiles (way_id, x, y) VALUES (?, ?, ?)",
  );
  const insertTileRow = db.prepare(
    "INSERT OR IGNORE INTO tiles (x, y, fetched_at) VALUES (?, ?, ?)",
  );
  const coordsOf = db.prepare("SELECT lat, lon FROM nodes WHERE id = ?");
  const allWays = db.prepare("SELECT id, node_ids FROM ways");

  const now = Date.now();
  let done = 0;
  let dropped = 0;
  db.exec("BEGIN");
  for (const row of allWays.iterate() as Iterable<{ id: number; node_ids: string }>) {
    const refs: number[] = JSON.parse(row.node_ids);
    const coords: { lat: number; lon: number }[] = [];
    for (const ref of refs) {
      const c = coordsOf.get(ref) as { lat: number; lon: number } | undefined;
      // 抽出範囲の外に出ている way は座標が揃わない。グラフ構築が捨てるので、ここでも落とす
      if (!c) break;
      coords.push(c);
    }
    if (coords.length !== refs.length) {
      dropped++;
    } else {
      for (const tile of tilesForNodes(coords)) {
        insertTile.run(row.id, tile.x, tile.y);
        insertTileRow.run(tile.x, tile.y, now);
      }
    }
    done++;
    if (done % 500_000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      log(`  ${done.toLocaleString()} 本`);
    }
  }
  db.exec("COMMIT");
  log(`振り分けおわり: ${done.toLocaleString()} 本、うち座標が揃わず落としたのが ${dropped.toLocaleString()} 本`);
}

function finish() {
  log("後始末");
  // 座標が揃わず捨てた way は way_tiles に入っていない。ways からも消す
  db.exec("DELETE FROM ways WHERE id NOT IN (SELECT way_id FROM way_tiles)");
  db.exec("DELETE FROM nodes WHERE id NOT IN (SELECT value FROM ways, json_each(ways.node_ids))");
  db.exec("DROP TABLE needed_nodes");
  db.exec("DROP TABLE arterials");
  db.exec("DROP TABLE poi_ways");
  // タイル側から way を引く索引。lib/db.ts の initSchema と同じものを、
  // ここで作っておく。端末に作らせると初回起動が数分になり、
  // 「端末上での事前処理は 5 分以内」(requirements.md#f-10) を脅かす
  db.exec("CREATE INDEX IF NOT EXISTS way_tiles_xy ON way_tiles (x, y)");
  db.exec("CREATE INDEX IF NOT EXISTS pois_xy ON pois (x, y)");
  db.exec(`PRAGMA user_version = 5`);
  db.exec("VACUUM");

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const bytes =
    (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count *
    (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;

  console.log();
  console.log("=== できあがり ===");
  console.log(`  way        : ${count("SELECT COUNT(*) n FROM ways").toLocaleString()}`);
  console.log(`  node       : ${count("SELECT COUNT(*) n FROM nodes").toLocaleString()}`);
  console.log(`  タイル     : ${count("SELECT COUNT(*) n FROM tiles").toLocaleString()}`);
  console.log(`  地点       : ${count("SELECT COUNT(*) n FROM pois").toLocaleString()}`);
  console.log(`  サイズ     : ${(bytes / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  かかった時間: ${elapsed()}`);

  // Step 1 の実測値と突き合わせる
  const dev = tileAt(35.62, 139.7);
  const devWays = (
    db
      .prepare("SELECT COUNT(*) n FROM way_tiles WHERE x = ? AND y = ?")
      .get(dev.x, dev.y) as { n: number }
  ).n;
  console.log();
  console.log(`  武蔵小山タイル ${dev.x}/${dev.y} の way: ${devWays.toLocaleString()}（Step 1 の実測は 1,806）`);
}

// トップレベル await は使わない。tsx が CJS に変換するため通らない
async function main() {
  await pass1CollectWays();
  await pass2CollectNodes();
  markSidepaths();
  centroidPois();
  assignTiles();
  finish();
  db.close();
}

main();
