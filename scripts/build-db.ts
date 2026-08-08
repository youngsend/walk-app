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
 *             参照している node の ID を needed_nodes に控える
 *   2 パス目: node を読み、needed_nodes にあるものだけ nodes に入れる
 *   仕上げ  : way ごとに、構成ノードが入るタイルを way_tiles に書く
 *
 * 抽出の規則（isWalkable / tilesForNodes）はアプリと共有している。
 * 別々に書くと Step 1 の実測値と食い違ってしまう。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import osmParser from "osm-pbf-parser";

import { isWalkable, tilesForNodes } from "../lib/osm-filter";
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
  CREATE TABLE ways (id INTEGER PRIMARY KEY, node_ids TEXT NOT NULL, highway TEXT NOT NULL, lanes REAL);
  CREATE TABLE way_tiles (way_id INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, PRIMARY KEY (way_id, x, y));

  -- 作業用。最後に落とす
  CREATE TABLE needed_nodes (id INTEGER PRIMARY KEY);
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
    "INSERT OR REPLACE INTO ways (id, node_ids, highway, lanes) VALUES (?, ?, ?, ?)",
  );
  const insertNeeded = db.prepare("INSERT OR IGNORE INTO needed_nodes (id) VALUES (?)");

  let seen = 0;
  let kept = 0;
  db.exec("BEGIN");
  await readPbf((item) => {
    if (item.type !== "way") return;
    seen++;
    const tags = item.tags ?? {};
    if (!isWalkable(tags)) return;
    const refs = item.refs ?? [];
    if (refs.length < 2) return;

    const lanes = parseFloat(tags.lanes);
    insertWay.run(
      item.id,
      JSON.stringify(refs),
      tags.highway,
      Number.isFinite(lanes) ? lanes : null,
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
  log(`1 パス目おわり: ${seen.toLocaleString()} 本中 ${kept.toLocaleString()} 本を採用`);
}

async function pass2CollectNodes() {
  log("2 パス目: node を読む");
  const isNeeded = db.prepare("SELECT 1 FROM needed_nodes WHERE id = ?");
  const insertNode = db.prepare(
    "INSERT OR REPLACE INTO nodes (id, lat, lon) VALUES (?, ?, ?)",
  );

  let seen = 0;
  let kept = 0;
  db.exec("BEGIN");
  await readPbf((item) => {
    if (item.type !== "node") return;
    seen++;
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
  log(`2 パス目おわり: ${seen.toLocaleString()} 個中 ${kept.toLocaleString()} 個を採用`);
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
  db.exec(`PRAGMA user_version = 2`);
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

await pass1CollectWays();
await pass2CollectNodes();
assignTiles();
finish();
db.close();
