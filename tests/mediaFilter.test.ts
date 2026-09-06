import { describe, it, expect } from "vitest";
import { filterMedia } from "../utils/mediaFilter.js";

// Minimal stand-in for what anilist-node returns from media.anime().
function media(overrides: Record<string, unknown> = {}): any {
  return {
    id: 21,
    idMal: 21,
    title: { romaji: "One Piece", english: "One Piece", native: "ONE PIECE", userPreferred: "One Piece" },
    format: "TV",
    status: "RELEASING",
    description: "…",
    startDate: { year: 1999, month: 10, day: 20 },
    endDate: { year: null, month: null, day: null },
    countryOfOrigin: "JP",
    isLicensed: true,
    hashtag: "#ONEPIECE",
    updatedAt: 1,
    coverImage: { large: "l", medium: "m", small: "s", color: "#fff" },
    bannerImage: "b",
    genres: ["Action"],
    synonyms: [],
    averageScore: 88,
    meanScore: 88,
    popularity: 1,
    favourites: 1,
    isAdult: false,
    siteUrl: "https://anilist.co/anime/21",
    ...overrides,
  };
}

describe("filterMedia nextAiringEpisode", () => {
  it("keeps nextAiringEpisode when AniList returns it as a single object", () => {
    // AniList returns an object here. anilist-node's .d.ts declares
    // AiringEntry[], which is wrong — trusting it dropped the field entirely.
    const result: any = filterMedia(
      media({ nextAiringEpisode: { airingAt: 1788704160, timeUntilAiring: 51888, episode: 1177 } }),
    );
    expect(result.nextAiringEpisode).toEqual({
      airingAt: 1788704160,
      timeUntilAiring: 51888,
      episode: 1177,
    });
  });

  it("also accepts the array shape the library's types claim", () => {
    const result: any = filterMedia(
      media({ nextAiringEpisode: [{ airingAt: 2, timeUntilAiring: 3, episode: 4 }] }),
    );
    expect(result.nextAiringEpisode).toEqual({ airingAt: 2, timeUntilAiring: 3, episode: 4 });
  });

  it("omits the field entirely when the media is not airing", () => {
    const result: any = filterMedia(media({ nextAiringEpisode: null }));
    expect(result.nextAiringEpisode).toBeUndefined();
  });
});
