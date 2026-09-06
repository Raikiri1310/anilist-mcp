import { describe, it, expect, vi } from "vitest";
import { MEDIA_FILTER_GQL_TYPES } from "../utils/anilistGraphql.js";
import {
  ActivitySortSchema,
  MediaFilterTypesSchema,
  MediaSourceSchema,
  NotificationTypeSchema,
  UpdateEntryOptionsSchema,
} from "../utils/schemas.js";

// Captured from live introspection of https://graphql.anilist.co (2026-09-05).
// Kept as literals so the suite stays offline; refresh if AniList adds values.
const LIVE_MEDIA_SOURCE = [
  "ORIGINAL", "MANGA", "LIGHT_NOVEL", "VISUAL_NOVEL", "VIDEO_GAME", "OTHER",
  "NOVEL", "DOUJINSHI", "ANIME", "WEB_NOVEL", "LIVE_ACTION", "GAME", "COMIC",
  "MULTIMEDIA_PROJECT", "PICTURE_BOOK",
];

const LIVE_NOTIFICATION_TYPE = [
  "ACTIVITY_MESSAGE", "ACTIVITY_REPLY", "FOLLOWING", "ACTIVITY_MENTION",
  "THREAD_COMMENT_MENTION", "THREAD_SUBSCRIBED", "THREAD_COMMENT_REPLY",
  "AIRING", "ACTIVITY_LIKE", "ACTIVITY_REPLY_LIKE", "THREAD_LIKE",
  "THREAD_COMMENT_LIKE", "ACTIVITY_REPLY_SUBSCRIBED", "RELATED_MEDIA_ADDITION",
  "MEDIA_DATA_CHANGE", "MEDIA_MERGE", "MEDIA_DELETION",
  "MEDIA_SUBMISSION_UPDATE", "STAFF_SUBMISSION_UPDATE",
  "CHARACTER_SUBMISSION_UPDATE",
];

const LIVE_ACTIVITY_SORT = ["ID", "ID_DESC", "PINNED"];

describe("enums cover every value AniList accepts", () => {
  it("MediaSource", () => {
    const rejected = LIVE_MEDIA_SOURCE.filter(
      (v) => !MediaSourceSchema.safeParse(v).success,
    );
    expect(rejected).toEqual([]);
  });

  it("NotificationType", () => {
    // update_user requires the full options object, so a single missing
    // value makes settings impossible to read-modify-write.
    const rejected = LIVE_NOTIFICATION_TYPE.filter(
      (v) => !NotificationTypeSchema.safeParse(v).success,
    );
    expect(rejected).toEqual([]);
  });

  it("ActivitySort", () => {
    const rejected = LIVE_ACTIVITY_SORT.filter(
      (v) => !ActivitySortSchema.safeParse(v).success,
    );
    expect(rejected).toEqual([]);
  });
});

describe("media filter fields reach the API", () => {
  // The bug this fork exists to fix was a filter that was accepted and then
  // silently dropped. searchMediaDirect only emits keys present in
  // MEDIA_FILTER_GQL_TYPES, so a field added to the Zod schema alone would
  // reintroduce exactly that failure — with no error to notice it by.
  it("every MediaFilterTypesSchema field has a GraphQL type mapping", () => {
    const unmapped = Object.keys(MediaFilterTypesSchema.shape).filter(
      // `type` is intentionally excluded: the tool pins it, not the caller.
      (k) => k !== "type" && !MEDIA_FILTER_GQL_TYPES[k],
    );
    expect(unmapped).toEqual([]);
  });

  it("the generated map is a superset of what we expose", () => {
    // MEDIA_FILTER_GQL_TYPES is generated from every Query.Media argument,
    // so it may legitimately contain filters we choose not to expose. What
    // must never happen is exposing a filter AniList does not accept.
    const unmapped = Object.keys(MediaFilterTypesSchema.shape).filter(
      (k) => k !== "type" && !MEDIA_FILTER_GQL_TYPES[k],
    );
    expect(unmapped).toEqual([]);
    expect(Object.keys(MEDIA_FILTER_GQL_TYPES).length).toBeGreaterThanOrEqual(
      Object.keys(MediaFilterTypesSchema.shape).length - 1,
    );
  });

  it("exposes the licensing and country filters AniList supports", () => {
    for (const field of [
      { licensedById: 1 },
      { licensedById_in: [1, 2] },
      { isLicensed: true },
      { countryOfOrigin_in: ["JP", "KR"] },
      { countryOfOrigin_not_in: ["CN"] },
    ]) {
      expect(MediaFilterTypesSchema.safeParse(field).success).toBe(true);
    }
  });
});

describe("FuzzyDateInput accepts partial and cleared dates", () => {
  it("allows a year-only start date", () => {
    const r = UpdateEntryOptionsSchema.safeParse({ startedAt: { year: 2020 } });
    expect(r.success).toBe(true);
  });

  it("allows clearing a completion date with nulls", () => {
    const r = UpdateEntryOptionsSchema.safeParse({
      completedAt: { year: null, month: null, day: null },
    });
    expect(r.success).toBe(true);
  });

  it("still accepts a full date", () => {
    const r = UpdateEntryOptionsSchema.safeParse({
      startedAt: { year: 2020, month: 3, day: 14 },
    });
    expect(r.success).toBe(true);
  });
});

describe("versioned enum fields", () => {
  // AniList's status/source fields default to a legacy enum: unversioned they
  // report HIATUS titles as RELEASING and collapse the six newer sources into
  // OTHER. Verified live — Vagabond reads RELEASING at v1 and HIATUS at v2.
  it("requests the current status and source enums", async () => {
    const { searchMediaDirect } = await import("../utils/anilistGraphql.js");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { Page: { media: [] } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await searchMediaDirect("ANIME", "x", undefined, 1, 1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain("status(version: 2)");
    expect(body.query).toContain("source(version: 3)");
    vi.unstubAllGlobals();
  });
});
