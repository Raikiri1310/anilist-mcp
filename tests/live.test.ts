import { describe, it, expect } from "vitest";
import { getMediaDirect, searchMediaDirect } from "../utils/anilistGraphql.js";
import { MediaSourceSchema, MEDIA_FILTER_GQL_TYPES } from "../utils/schemas.generated.js";

const live = describe.skipIf(!process.env.ANILIST_LIVE);

// Offline tests can only prove we ASK for version 2 and 3. Only these prove
// the values that come back are right — which is the bug that shipped.
live("live AniList", () => {
  it("returns HIATUS, not the legacy RELEASING", async () => {
    const r: any = await searchMediaDirect(
      "MANGA", undefined, { status: "HIATUS", sort: ["POPULARITY_DESC"] }, 1, 3,
    );
    expect(r.media.map((m: any) => m.status)).toEqual(["HIATUS", "HIATUS", "HIATUS"]);
  }, 30_000);

  it("returns WEB_NOVEL, not the legacy OTHER", async () => {
    const r: any = await searchMediaDirect(
      "ANIME", undefined, { source: "WEB_NOVEL", sort: ["POPULARITY_DESC"] }, 1, 2,
    );
    expect(r.media.map((m: any) => m.source)).toEqual(["WEB_NOVEL", "WEB_NOVEL"]);
  }, 30_000);

  it("batches ids and reports the missing ones", async () => {
    const r = await getMediaDirect("ANIME", [21, 154587, 999999999], []);
    expect(r.media).toHaveLength(2);
    expect(r.notFound).toEqual([999999999]);
  }, 30_000);

  it("the committed schema is still current", async () => {
    const q = `query { __type(name: "MediaSource") { enumValues { name } }
                       Q: __type(name: "Query") { fields { name args { name } } } }`;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const j: any = await res.json();
    const liveSources = j.data.__type.enumValues.map((v: any) => v.name).sort();
    expect([...MediaSourceSchema.options].sort()).toEqual(liveSources);

    const liveArgs = j.data.Q.fields.find((f: any) => f.name === "Media")
      .args.map((a: any) => a.name).sort();
    expect(Object.keys(MEDIA_FILTER_GQL_TYPES).sort()).toEqual(liveArgs);
  }, 30_000);
});
