import { describe, it, expect, vi, afterEach } from "vitest";
import { getMediaDirect } from "../utils/anilistGraphql.js";

function mockPage(media: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { Page: { media } } }),
  });
}

function lastBody() {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

function authHeader() {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][1].headers.Authorization;
}

afterEach(() => vi.unstubAllGlobals());

describe("getMediaDirect", () => {
  it("fetches many ids in a SINGLE request", async () => {
    const fetchMock = mockPage([{ id: 1 }, { id: 5 }, { id: 21 }, { id: 30 }]);
    vi.stubGlobal("fetch", fetchMock);
    await getMediaDirect("ANIME", [1, 5, 21, 30], []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().variables.ids).toEqual([1, 5, 21, 30]);
    expect(lastBody().query).toContain("id_in: $ids");
  });

  it("returns results in the order the caller asked for", async () => {
    vi.stubGlobal("fetch", mockPage([{ id: 21 }, { id: 1 }, { id: 5 }]));
    const out = await getMediaDirect("ANIME", [1, 5, 21], []);
    expect((out.media as Array<{ id: number }>).map((m) => m.id)).toEqual([1, 5, 21]);
  });

  it("reports ids AniList did not return", async () => {
    vi.stubGlobal("fetch", mockPage([{ id: 21 }]));
    const out = await getMediaDirect("ANIME", [21, 999999999], []);
    expect(out.notFound).toEqual([999999999]);
    expect(out.media).toHaveLength(1);
  });

  it("always reports notFound as an array, never omitted", async () => {
    vi.stubGlobal("fetch", mockPage([{ id: 21 }]));
    expect((await getMediaDirect("ANIME", [21], [])).notFound).toEqual([]);
  });

  it("pins the media type", async () => {
    vi.stubGlobal("fetch", mockPage([]));
    await getMediaDirect("MANGA", [1], []);
    expect(lastBody().variables.type).toBe("MANGA");
  });

  it("authenticates only for the viewer group", async () => {
    vi.stubGlobal("fetch", mockPage([{ id: 21 }]));
    await getMediaDirect("ANIME", [21], ["viewer"], "tok");
    expect(authHeader()).toBe("Bearer tok");

    await getMediaDirect("ANIME", [21], ["tags"], "tok");
    expect(authHeader()).toBeUndefined();

    await getMediaDirect("ANIME", [21], [], "tok");
    expect(authHeader()).toBeUndefined();
  });

  it("normalizes the response", async () => {
    vi.stubGlobal("fetch", mockPage([
      { id: 21, episodes: null, studios: { edges: [{ isMain: true, node: { id: 18 } }] } },
    ]));
    const out: any = await getMediaDirect("ANIME", [21], ["studios"]);
    expect(out.media[0].studios).toEqual([{ isMain: true, node: { id: 18 } }]);
    expect(out.media[0].episodes).toBeUndefined();
  });

  it("surfaces the AniList error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, statusText: "Bad Request",
      json: () => Promise.resolve({ errors: [{ message: "Invalid token" }] }),
    }));
    await expect(getMediaDirect("ANIME", [21], ["viewer"], "bad"))
      .rejects.toThrow("AniList API error (400): Invalid token");
  });
});
