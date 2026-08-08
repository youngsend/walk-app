import { OVERPASS_ENDPOINTS, countByHighway, fetchTile } from "@/lib/overpass";

const TILE = { x: 6985, y: 1781 };

/** Overpass の応答を模した JSON。 */
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response;
}

const SAMPLE = {
  elements: [
    { type: "way", id: 1, nodes: [10, 11], tags: { highway: "residential" } },
    { type: "way", id: 2, nodes: [11, 12], tags: { highway: "footway" } },
    { type: "node", id: 10, lat: 35.62, lon: 139.7 },
    { type: "node", id: 11, lat: 35.621, lon: 139.7 },
    { type: "node", id: 12, lat: 35.622, lon: 139.7 },
  ],
};

describe("OVERPASS_ENDPOINTS", () => {
  it("フォールバック先を複数持つ", () => {
    // 公開サーバーは過負荷で 504 を返すことがあるため
    expect(OVERPASS_ENDPOINTS.length).toBeGreaterThan(1);
  });
});

describe("fetchTile", () => {
  it("way と node に分けて返す", async () => {
    const fetchImpl = jest.fn(async () => response(SAMPLE));
    const data = await fetchTile(TILE, { fetchImpl });

    expect(data.ways).toHaveLength(2);
    expect(data.nodes).toHaveLength(3);
    expect(data.ways[0]).toEqual({
      id: 1,
      nodes: [10, 11],
      tags: { highway: "residential" },
    });
    expect(data.nodes[0]).toEqual({ id: 10, lat: 35.62, lon: 139.7 });
  });

  it("タグの無い way でも落ちない", async () => {
    const fetchImpl = jest.fn(async () =>
      response({ elements: [{ type: "way", id: 1, nodes: [10, 11] }] }),
    );
    const data = await fetchTile(TILE, { fetchImpl });
    expect(data.ways[0].tags).toEqual({});
  });

  it("タイルの bbox をクエリに含める", async () => {
    const fetchImpl = jest.fn(async () => response(SAMPLE));
    await fetchTile(TILE, { fetchImpl });

    const body = String((fetchImpl.mock.calls[0] as any)[1].body);
    const query = decodeURIComponent(body.replace(/^data=/, ""));
    expect(query).toContain("35.62,139.7,35.64,139.72");
  });

  it("ノード ID が返る取得形式を使う", async () => {
    // 座標のみの out geom では隣接タイルを ID で繋げない
    const fetchImpl = jest.fn(async () => response(SAMPLE));
    await fetchTile(TILE, { fetchImpl });

    const body = String((fetchImpl.mock.calls[0] as any)[1].body);
    const query = decodeURIComponent(body.replace(/^data=/, ""));
    expect(query).toContain("out body");
    expect(query).toContain("out skel qt");
    expect(query).not.toContain("out geom");
  });

  it("1 つ目が成功すれば 2 つ目は叩かない", async () => {
    const fetchImpl = jest.fn(async () => response(SAMPLE));
    await fetchTile(TILE, { fetchImpl, endpoints: ["https://a", "https://b"] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as any)[0]).toBe("https://a");
  });

  it("504 が返ったら次のエンドポイントを試す", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(null, 504))
      .mockResolvedValueOnce(response(SAMPLE));

    const data = await fetchTile(TILE, {
      fetchImpl,
      endpoints: ["https://a", "https://b"],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1] as any)[0]).toBe("https://b");
    expect(data.ways).toHaveLength(2);
  });

  it("通信そのものが失敗しても次を試す", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(response(SAMPLE));

    const data = await fetchTile(TILE, {
      fetchImpl,
      endpoints: ["https://a", "https://b"],
    });

    expect(data.nodes).toHaveLength(3);
  });

  it("全滅したら、試した結果が分かるエラーを投げる", async () => {
    const fetchImpl = jest.fn(async () => response(null, 504));

    await expect(
      fetchTile(TILE, { fetchImpl, endpoints: ["https://a", "https://b"] }),
    ).rejects.toThrow(/a.*504[\s\S]*b.*504/);
  });
});

describe("countByHighway", () => {
  it("種別ごとに数え、多い順に並べる", () => {
    const ways = [
      { id: 1, nodes: [], tags: { highway: "footway" } },
      { id: 2, nodes: [], tags: { highway: "residential" } },
      { id: 3, nodes: [], tags: { highway: "footway" } },
    ];
    expect(countByHighway(ways)).toEqual([
      ["footway", 2],
      ["residential", 1],
    ]);
  });

  it("highway が無い way も数える", () => {
    expect(countByHighway([{ id: 1, nodes: [], tags: {} }])).toEqual([["(none)", 1]]);
  });
});
