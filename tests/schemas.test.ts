import { describe, it, expect } from "vitest";
import {
  MediaFilterTypesSchema,
  MediaSeasonSchema,
  MediaSourceSchema,
  MediaFormatSchema,
} from "../utils/schemas.js";

describe("MediaFilterTypesSchema", () => {
  it("accepts valid season and seasonYear filters", () => {
    const result = MediaFilterTypesSchema.safeParse({
      season: "SPRING",
      seasonYear: 2026,
      sort: ["POPULARITY_DESC"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid season values", () => {
    const result = MediaFilterTypesSchema.safeParse({ season: "MONSOON" });
    expect(result.success).toBe(false);
  });

  it("source field uses MediaSourceSchema, not MediaFormatSchema", () => {
    // MediaSourceSchema values (ORIGINAL, MANGA, LIGHT_NOVEL, etc.)
    const validSource = MediaFilterTypesSchema.safeParse({ source: "LIGHT_NOVEL" });
    expect(validSource.success).toBe(true);

    // MediaFormatSchema values (TV, MOVIE, OVA, etc.) should NOT be valid for source
    const invalidSource = MediaFilterTypesSchema.safeParse({ source: "TV" });
    expect(invalidSource.success).toBe(false);
  });

  it("accepts all valid MediaSeason values", () => {
    for (const season of ["WINTER", "SPRING", "SUMMER", "FALL"]) {
      const result = MediaFilterTypesSchema.safeParse({ season });
      expect(result.success).toBe(true);
    }
  });

  it("accepts sort array with multiple values", () => {
    const result = MediaFilterTypesSchema.safeParse({
      sort: ["SCORE_DESC", "POPULARITY_DESC"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty filter object", () => {
    const result = MediaFilterTypesSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("MediaSourceSchema vs MediaFormatSchema", () => {
  it("MediaSourceSchema includes LIGHT_NOVEL and VISUAL_NOVEL", () => {
    expect(MediaSourceSchema.safeParse("LIGHT_NOVEL").success).toBe(true);
    expect(MediaSourceSchema.safeParse("VISUAL_NOVEL").success).toBe(true);
  });

  it("MediaFormatSchema does not include LIGHT_NOVEL", () => {
    expect(MediaFormatSchema.safeParse("LIGHT_NOVEL").success).toBe(false);
  });
});
