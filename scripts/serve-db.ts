/**
 * 生成した DB を自宅 Wi-Fi 越しに端末へ渡すための HTTP サーバ。
 * docs/development-plan.md の Step 3-3
 *
 *   npx tsx scripts/serve-db.ts ~/Downloads/walk.db [ポート]
 *
 * 年 1 回の地図更新でも同じものを使う。常時動かすものではないので、
 * 認証も TLS も無い。自宅の LAN でだけ立てること。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const [, , dbPath, portArg] = process.argv;
if (!dbPath) {
  console.error("使い方: npx tsx scripts/serve-db.ts <walk.db> [ポート]");
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`ファイルが無い: ${dbPath}`);
  process.exit(1);
}

const port = Number(portArg ?? 8080);
const name = path.basename(dbPath);

/** LAN で端末から見えるアドレス。 */
function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) found.push(net.address);
    }
  }
  return found;
}

const server = http.createServer((req, res) => {
  const { size } = fs.statSync(dbPath);

  // 端末が転送前に容量を確かめるため、まず大きさだけ answer できるようにする
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Length": String(size),
      "Content-Type": "application/vnd.sqlite3",
      "Accept-Ranges": "bytes",
    });
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }

  // 中断からの再開に応えられるようにしておく（670MB を一度で落とせなかった場合）
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === "" ? 0 : Number(m[1]);
      const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      console.log(`[${new Date().toLocaleTimeString()}] 再開 ${start}-${end}`);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
        "Content-Type": "application/vnd.sqlite3",
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(dbPath, { start, end }).pipe(res);
      return;
    }
  }

  console.log(
    `[${new Date().toLocaleTimeString()}] 転送開始 ${(size / 1024 / 1024).toFixed(0)}MB → ${req.socket.remoteAddress}`,
  );
  const started = Date.now();
  res.writeHead(200, {
    "Content-Length": String(size),
    "Content-Type": "application/vnd.sqlite3",
    "Accept-Ranges": "bytes",
  });
  const stream = fs.createReadStream(dbPath);
  stream.pipe(res);
  res.on("finish", () => {
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `  おわり ${seconds.toFixed(0)}s（${(size / 1024 / 1024 / seconds).toFixed(1)} MB/s）`,
    );
  });
  res.on("close", () => stream.destroy());
});

server.listen(port, () => {
  const { size } = fs.statSync(dbPath);
  console.log(`${name} を配る（${(size / 1024 / 1024).toFixed(0)} MB）`);
  console.log();
  for (const address of lanAddresses()) {
    console.log(`  http://${address}:${port}/${name}`);
  }
  console.log();
  console.log("iPhone と Mac が同じ Wi-Fi にいること。Ctrl+C で止める");
});
