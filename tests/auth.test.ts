import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchMediaDirect,
  saveMediaListEntryDirect,
} from "../utils/anilistGraphql.js";

function okFetch(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  });
}

function authHeaderOf(call: number = 0) {
  const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[call];
  return init.headers.Authorization;
}

describe("searchMediaDirect authorization", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", okFetch({ Page: { media: [] } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT send Authorization for a public search, even with a token configured", async () => {
    // A stale token must not be able to break public search: AniList rejects
    // the whole request with 400 "Invalid token" when the header is present.
    await searchMediaDirect("ANIME", "naruto", undefined, 1, 5, [], "some-token");
    expect(authHeaderOf()).toBeUndefined();
  });

  it("does NOT send Authorization for filters that work anonymously", async () => {
    await searchMediaDirect("ANIME", undefined, { season: "SPRING", seasonYear: 2026 }, 1, 5, [], "some-token");
    expect(authHeaderOf()).toBeUndefined();
  });

  it("DOES send Authorization when the onList filter is used", async () => {
    await searchMediaDirect("ANIME", undefined, { onList: true }, 1, 5, [], "some-token");
    expect(authHeaderOf()).toBe("Bearer some-token");
  });

  it("trims the token and ignores a whitespace-only one", async () => {
    await searchMediaDirect("ANIME", undefined, { onList: true }, 1, 5, [], "  padded-token  ");
    expect(authHeaderOf()).toBe("Bearer padded-token");

    await searchMediaDirect("ANIME", undefined, { onList: true }, 1, 5, [], "   ");
    expect(authHeaderOf(1)).toBeUndefined();
  });
});

describe("AniList error messages are surfaced, not discarded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searchMediaDirect reports the API message from a non-ok response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: () => Promise.resolve({ data: null, errors: [{ message: "Invalid token", status: 400 }] }),
    }));
    await expect(
      searchMediaDirect("ANIME", "naruto", undefined, 1, 5),
    ).rejects.toThrow("AniList API error (400): Invalid token");
  });

  it("saveMediaListEntryDirect reports the API message from a non-ok response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: () => Promise.resolve({ data: null, errors: [{ message: "Invalid token", status: 400 }] }),
    }));
    await expect(
      saveMediaListEntryDirect(21, "mediaId", { progress: 5 }, "bad-token"),
    ).rejects.toThrow("AniList API error (400): Invalid token");
  });

  it("still falls back to the status line when the body has no usable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }));
    await expect(
      searchMediaDirect("ANIME", undefined, undefined, 1, 5),
    ).rejects.toThrow("AniList API error: 429 Too Many Requests");
  });
});
