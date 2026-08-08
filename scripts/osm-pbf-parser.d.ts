/**
 * osm-pbf-parser には型定義が無い。使うのは「読み込みストリームに
 * pipe すると、node / way / relation の配列が流れてくる」ことだけ。
 */
declare module "osm-pbf-parser" {
  import { Transform } from "node:stream";
  function osmParser(): Transform;
  export = osmParser;
}
