import { describe, it, expect } from "vitest";
import {
  buildMediaSelection,
  requiresAuth,
  MediaGroupSchema,
  POST_FETCH_CAPS,
} from "../utils/mediaSelection.js";

describe("buildMediaSelection", () => {
  it("always includes core fields", () => {
    const sel = buildMediaSelection([]);
    expect(sel).toContain("id idMal");
    expect(sel).toContain("title {");
    expect(sel).toContain("nextAiringEpisode {");
  });

  it("pins the versioned enums in core", () => {
    // Unversioned, AniList returns the legacy v1 set: HIATUS reads as
    // RELEASING and the six newer sources collapse to OTHER.
    const sel = buildMediaSelection([]);
    expect(sel).toContain("status(version: 2)");
    expect(sel).toContain("source(version: 3)");
  });

  it("includes a requested group", () => {
    expect(buildMediaSelection(["studios"])).toContain("studios {");
  });

  it("omits every group that was not requested", () => {
    const sel = buildMediaSelection(["studios"]);
    for (const absent of ["reviews", "characters", "staff", "recommendations",
                          "airingSchedule", "streamingEpisodes", "mediaListEntry"]) {
      expect(sel).not.toContain(absent);
    }
  });

  it("never selects review bodies", () => {
    // reviews.body is 143,970 of the 217,738 chars in a full One Piece response.
    const sel = buildMediaSelection(["reviews"]);
    expect(sel).toContain("reviews(");
    expect(sel).toContain("summary");
    expect(sel).not.toMatch(/\bbody\b/);
  });

  it("deduplicates repeated groups", () => {
    const sel = buildMediaSelection(["tags", "tags"]);
    expect(sel.match(/tags \{/g)).toHaveLength(1);
  });

  it("treats undefined as no groups", () => {
    expect(buildMediaSelection()).toBe(buildMediaSelection([]));
  });
});

describe("MediaGroupSchema", () => {
  it("accepts every documented group", () => {
    for (const g of ["tags", "studios", "characters", "staff", "relations",
                     "recommendations", "reviews", "links", "episodes",
                     "rankings", "airing", "stats", "viewer", "meta"]) {
      expect(MediaGroupSchema.safeParse(g).success).toBe(true);
    }
  });

  it("rejects an unknown group", () => {
    expect(MediaGroupSchema.safeParse("kitchen_sink").success).toBe(false);
  });
});

describe("requiresAuth", () => {
  it("is true only for the viewer group", () => {
    expect(requiresAuth(["viewer"])).toBe(true);
    expect(requiresAuth(["tags", "studios"])).toBe(false);
    expect(requiresAuth([])).toBe(false);
    expect(requiresAuth()).toBe(false);
  });
});

describe("POST_FETCH_CAPS", () => {
  it("caps only the fields AniList cannot paginate server-side", () => {
    expect(POST_FETCH_CAPS).toEqual({ tags: 10, relations: 25, streamingEpisodes: 10 });
  });
});
