import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchMediaDirect } from "../utils/anilistGraphql.js";

const MOCK_PAGE_RESPONSE = {
  pageInfo: { total: 1, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 5 },
  media: [
    {
      id: 999,
      title: { romaji: "Test Anime Spring 2026", english: null, native: null, userPreferred: "Test Anime Spring 2026" },
      season: "SPRING",
      seasonYear: 2026,
      siteUrl: "https://anilist.co/anime/999",
    },
  ],
};

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { Page: data } }),
  });
}

describe("searchMediaDirect", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchSuccess(MOCK_PAGE_RESPONSE));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes season and seasonYear as GraphQL variables, not inlined", async () => {
    await searchMediaDirect("ANIME", undefined, { season: "SPRING", seasonYear: 2026 }, 1, 5);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.variables.season).toBe("SPRING");
    expect(body.variables.seasonYear).toBe(2026);
    // Variables must not be inlined — query must use $season and $seasonYear
    expect(body.query).toContain("$season: MediaSeason");
    expect(body.query).toContain("$seasonYear: Int");
    expect(body.query).toContain("season: $season");
    expect(body.query).toContain("seasonYear: $seasonYear");
    // Must NOT inline values directly
    expect(body.query).not.toMatch(/season:\s*SPRING/);
    expect(body.query).not.toMatch(/seasonYear:\s*2026/);
  });

  it("sets type: ANIME for anime searches", async () => {
    await searchMediaDirect("ANIME", undefined, undefined, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.type).toBe("ANIME");
  });

  it("sets type: MANGA for manga searches", async () => {
    await searchMediaDirect("MANGA", undefined, undefined, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.type).toBe("MANGA");
  });

  it("includes search term in variables when provided", async () => {
    await searchMediaDirect("ANIME", "Slime", undefined, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.search).toBe("Slime");
    expect(body.query).toContain("$search: String");
  });

  it("omits search variable when no term provided", async () => {
    await searchMediaDirect("ANIME", undefined, undefined, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.search).toBeUndefined();
    expect(body.query).not.toContain("$search");
  });

  it("converts FuzzyDate object to FuzzyDateInt for startDate", async () => {
    await searchMediaDirect("ANIME", undefined, { startDate: { year: 2026, month: 4, day: 1 } }, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.startDate).toBe(20260401);
  });

  it("handles sort filter correctly", async () => {
    await searchMediaDirect("ANIME", undefined, { sort: ["POPULARITY_DESC"] }, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.variables.sort).toEqual(["POPULARITY_DESC"]);
    expect(body.query).toContain("$sort: [MediaSort]");
  });

  it("returns the Page object from the response", async () => {
    const result = await searchMediaDirect("ANIME", undefined, { season: "SPRING", seasonYear: 2026 }, 1, 5);
    expect(result).toEqual(MOCK_PAGE_RESPONSE);
  });

  it("throws on non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }));
    await expect(
      searchMediaDirect("ANIME", undefined, undefined, 1, 5)
    ).rejects.toThrow("AniList API error: 429 Too Many Requests");
  });

  it("throws on GraphQL errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "Invalid filter" }] }),
    }));
    await expect(
      searchMediaDirect("ANIME", undefined, undefined, 1, 5)
    ).rejects.toThrow("AniList GraphQL error: Invalid filter");
  });

  it("skips type key from filter object (type is enforced by the tool)", async () => {
    await searchMediaDirect("ANIME", undefined, { type: "MANGA", season: "SPRING" }, 1, 5);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    // type from filter is ignored; tool-level type wins
    expect(body.variables.type).toBe("ANIME");
  });
});

// Documents the original library bug as a regression reference
describe("original library bug (regression documentation)", () => {
  it("season/year filters were silently dropped when using SEARCH_MATCH sort without a term", () => {
    // The anilist-node filterBuilder inlined values like `season: SPRING` directly
    // into the query string but the send() call only passed { search, page, perPage }.
    // GraphQL variables $season/$seasonYear were never declared or sent.
    // Result: AniList ignored the filter and returned ID-ascending results.
    // Fix: searchMediaDirect passes all filter fields as proper GraphQL variables.
    expect(true).toBe(true); // documented, not reproducible without the broken library
  });
});
