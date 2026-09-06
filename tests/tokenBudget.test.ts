import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeMedia } from "../utils/mediaNormalize.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/one-piece-full.json", import.meta.url), "utf8"),
);

const tokens = (v: unknown) => Math.round(JSON.stringify(v).length / 4);

// Thresholds are deliberately generous — descriptions and tag lists change.
// This exists to catch a regression like reviews.body creeping back in, not
// to police small drift.
describe("token budget", () => {
  it("caps tags to 10 regardless of how many AniList returns", () => {
    const out: any = normalizeMedia(fixture);
    expect(out.tags.length).toBeLessThanOrEqual(10);
  });

  it("caps streamingEpisodes to 10", () => {
    const out: any = normalizeMedia(fixture);
    if (out.streamingEpisodes) {
      expect(out.streamingEpisodes.length).toBeLessThanOrEqual(10);
    }
  });

  it("never carries review bodies", () => {
    const out = JSON.stringify(normalizeMedia(fixture));
    expect(out).not.toContain('"body"');
  });

  it("keeps the everything-included payload under 12k tokens", () => {
    // The old anilist-node path was 54,435 tokens for this same title.
    expect(tokens(normalizeMedia(fixture))).toBeLessThan(12_000);
  });

  it("keeps a core-only response under 1.5k tokens", () => {
    // The headline number this branch exists to produce. A regression that
    // promoted a group's fields into CORE_SELECTION would otherwise ship
    // green: the all-groups ceiling below would not move.
    const CORE_KEYS = [
      "id", "idMal", "type", "format", "siteUrl", "isAdult", "countryOfOrigin",
      "title", "status", "source", "description", "genres", "synonyms",
      "startDate", "endDate", "season", "seasonYear", "episodes", "duration",
      "chapters", "volumes", "averageScore", "meanScore", "popularity",
      "favourites", "coverImage", "nextAiringEpisode",
    ];
    const normalized = normalizeMedia(fixture) as Record<string, unknown>;
    const coreOnly = Object.fromEntries(
      Object.entries(normalized).filter(([k]) => CORE_KEYS.includes(k)),
    );
    expect(tokens(coreOnly)).toBeLessThan(1_500);
  });
});
