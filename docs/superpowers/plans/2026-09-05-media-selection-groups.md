# Media Selection Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `anilist-node`'s hardcoded media query with runtime-assembled GraphQL selection sets, so `get_anime`, `get_manga`, `search_anime` and `search_manga` fetch exactly the fields a caller asked for.

**Architecture:** A group registry (`utils/mediaSelection.ts`) maps group names to GraphQL fragments; `buildMediaSelection(groups)` concatenates core plus requested fragments. `getMediaDirect()` batches ids via `media(id_in:)` into one request. A pure normalization pipeline (`utils/mediaNormalize.ts`) unwraps connection envelopes, applies the three client-side caps, and drops nulls. Enums and filter-arg types are generated from schema introspection rather than hand-maintained.

**Tech Stack:** TypeScript (ESM, NodeNext), Zod 4, Vitest 2, `@modelcontextprotocol/sdk` 1.23, native `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-05-media-selection-groups-design.md`

## Global Constraints

- Node >= 18. ESM only — all relative imports end in `.js`, never `.ts`.
- Output keeps AniList's **real** field names. Never rename, alias, or merge fields. Unwrapping a `{nodes}`/`{edges}` envelope is allowed; merging `edges[].role` into `edges[].node` is **not**.
- Core selection must always carry `status(version: 2)` and `source(version: 3)`. Unversioned, AniList returns the legacy v1 enum.
- Only `tags`, `relations` and `streamingEpisodes` are trimmed client-side — they accept no server-side pagination args. Everything else caps via `perPage` in the query.
- `reviews` must never select `body`. That one field is 143,970 of the 217,738 characters in a full One Piece response.
- Authentication is opt-in per request. Only the `viewer` group sends `Authorization`. A stale token must never be able to break a public read.
- Version is `2.0.0` in all four places: `package.json`, `index.ts`, `manifest.json`, `Dockerfile`.
- Run `npx tsc --noEmit` and `npx vitest run` before every commit. Both must be clean.

---

### Task 1: Generate enums and filter types from the AniList schema

**Files:**
- Create: `scripts/sync-schema.ts`
- Create: `utils/schemas.generated.ts` (generated, committed)
- Modify: `utils/schemas.ts` — delete the 13 hand-written enums (lines 10–155), re-export from generated
- Modify: `utils/anilistGraphql.ts` — delete local `MEDIA_FILTER_GQL_TYPES` (lines 5–35), import it instead
- Modify: `tsconfig.json` — add `"scripts"` to `exclude`
- Modify: `package.json` — add `"sync-schema": "tsx scripts/sync-schema.ts"`
- Test: `tests/apiCoverage.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `utils/schemas.generated.ts` exporting `MediaTypeSchema`, `MediaFormatSchema`, `MediaStatusSchema`, `MediaSeasonSchema`, `MediaSourceSchema`, `MediaSortSchema`, `ActivitySortSchema`, `ActivityTypeSchema`, `UserTitleLanguageSchema`, `UserStaffNameLanguageSchema`, `ScoreFormatSchema`, `NotificationTypeSchema`, `EntryStatusSchema` (all `z.ZodEnum`), plus `MEDIA_FILTER_GQL_TYPES: Record<string, string>` and `SCHEMA_SYNCED_AT: string`.

- [ ] **Step 1: Write the generator**

Create `scripts/sync-schema.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Regenerates utils/schemas.generated.ts from live AniList introspection.
 * Run: pnpm run sync-schema
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const OUT = new URL("../utils/schemas.generated.ts", import.meta.url).pathname;

// AniList enum name -> our exported Zod schema name.
const ENUM_EXPORTS: Record<string, string> = {
  MediaType: "MediaTypeSchema",
  MediaFormat: "MediaFormatSchema",
  MediaStatus: "MediaStatusSchema",
  MediaSeason: "MediaSeasonSchema",
  MediaSource: "MediaSourceSchema",
  MediaSort: "MediaSortSchema",
  ActivitySort: "ActivitySortSchema",
  ActivityType: "ActivityTypeSchema",
  UserTitleLanguage: "UserTitleLanguageSchema",
  UserStaffNameLanguage: "UserStaffNameLanguageSchema",
  ScoreFormat: "ScoreFormatSchema",
  NotificationType: "NotificationTypeSchema",
  MediaListStatus: "EntryStatusSchema",
};

const QUERY = `query {
  __schema {
    types { kind name enumValues { name } }
  }
  Q: __type(name: "Query") {
    fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

function typeName(t: any): string {
  if (t.kind === "NON_NULL") return typeName(t.ofType);
  if (t.kind === "LIST") return `[${typeName(t.ofType)}]`;
  return t.name;
}

const res = await fetch("https://graphql.anilist.co", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ query: QUERY }),
});
const json: any = await res.json();
if (json.errors) throw new Error(JSON.stringify(json.errors));

const enums = new Map<string, string[]>(
  json.data.__schema.types
    .filter((t: any) => t.kind === "ENUM")
    .map((t: any) => [t.name, t.enumValues.map((v: any) => v.name)]),
);

const mediaArgs: Array<{ name: string; type: string }> = json.data.Q.fields
  .find((f: any) => f.name === "Media")
  .args.map((a: any) => ({ name: a.name, type: typeName(a.type) }));

const lines: string[] = [
  "// AUTO-GENERATED by scripts/sync-schema.ts — do not edit by hand.",
  "// Source: https://graphql.anilist.co introspection.",
  "// Regenerate with: pnpm run sync-schema",
  "",
  'import { z } from "zod";',
  "",
];

for (const [gqlName, exportName] of Object.entries(ENUM_EXPORTS)) {
  const values = enums.get(gqlName);
  if (!values) throw new Error(`AniList schema has no enum named ${gqlName}`);
  lines.push(`export const ${exportName} = z.enum([`);
  for (const v of values) lines.push(`  "${v}",`);
  lines.push("]);", "");
}

lines.push(
  "/** GraphQL types for every argument Query.Media accepts. */",
  "export const MEDIA_FILTER_GQL_TYPES: Record<string, string> = {",
);
for (const a of mediaArgs) lines.push(`  ${a.name}: "${a.type}",`);
lines.push("};", "");
lines.push(`export const SCHEMA_SYNCED_AT = "${new Date().toISOString().slice(0, 10)}";`, "");

const next = lines.join("\n");
const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
writeFileSync(OUT, next);

if (!prev) {
  console.log(`created ${OUT}`);
} else if (prev === next) {
  console.log("no schema changes");
} else {
  const names = (s: string) => new Set(s.match(/^  "?[A-Za-z_]+"?[,:]/gm)?.map((x) => x.trim()) ?? []);
  const before = names(prev), after = names(next);
  for (const n of after) if (!before.has(n)) console.log(`  + ${n}`);
  for (const n of before) if (!after.has(n)) console.log(`  - ${n}`);
  console.log(`updated ${OUT}`);
}
```

- [ ] **Step 2: Run it and inspect the output**

Run: `pnpm run sync-schema && head -30 utils/schemas.generated.ts`
Expected: `created .../utils/schemas.generated.ts`, and the file opens with the AUTO-GENERATED banner then `export const MediaTypeSchema = z.enum([ "ANIME", "MANGA", ]);`

Sanity-check that `MediaSourceSchema` contains `WEB_NOVEL` and `PICTURE_BOOK`, and that `MEDIA_FILTER_GQL_TYPES` contains `licensedById`, `isLicensed` and `countryOfOrigin_in`. If any are missing, the generator is wrong — fix it before continuing.

- [ ] **Step 3: Re-export from schemas.ts**

In `utils/schemas.ts`, delete the 13 hand-written `z.enum` declarations (currently lines 10–155: `MediaTypeSchema` through `EntryStatusSchema`) and replace them with:

```ts
// Enum values are generated from AniList introspection — see
// scripts/sync-schema.ts. Hand-maintaining them is what produced four
// separate silent gaps (six missing MediaSource values, three missing
// NotificationType values, ActivitySort.PINNED).
export {
  MediaTypeSchema,
  MediaFormatSchema,
  MediaStatusSchema,
  MediaSeasonSchema,
  MediaSourceSchema,
  MediaSortSchema,
  ActivitySortSchema,
  ActivityTypeSchema,
  UserTitleLanguageSchema,
  UserStaffNameLanguageSchema,
  ScoreFormatSchema,
  NotificationTypeSchema,
  EntryStatusSchema,
} from "./schemas.generated.js";

import {
  MediaFormatSchema,
  MediaSeasonSchema,
  MediaSortSchema,
  MediaSourceSchema,
  MediaStatusSchema,
  MediaTypeSchema,
  ActivitySortSchema,
  ActivityTypeSchema,
  NotificationTypeSchema,
  ScoreFormatSchema,
  UserStaffNameLanguageSchema,
  UserTitleLanguageSchema,
  EntryStatusSchema,
} from "./schemas.generated.js";
```

The `import` is needed because the rest of the file references these locally (e.g. `MediaFormatSchema` inside `MediaFilterTypesSchema`).

- [ ] **Step 4: Import the generated map in anilistGraphql.ts**

In `utils/anilistGraphql.ts`, delete the local `MEDIA_FILTER_GQL_TYPES` object (currently lines 5–35, the block starting `// GraphQL types for each field in MediaFilterTypesSchema`) and add to the imports at the top of the file:

```ts
import { MEDIA_FILTER_GQL_TYPES } from "./schemas.generated.js";
```

Re-export it so existing test imports keep working:

```ts
export { MEDIA_FILTER_GQL_TYPES };
```

- [ ] **Step 5: Exclude scripts from the build and add the npm script**

In `tsconfig.json` change the exclude line to:

```json
"exclude": ["node_modules", "dist", "tests", "scripts", "vitest.config.ts"]
```

In `package.json` add to `scripts`:

```json
"sync-schema": "tsx scripts/sync-schema.ts",
```

- [ ] **Step 6: Make the drift test one-directional**

In `tests/apiCoverage.test.ts`, the `"every GraphQL type mapping is reachable from the schema"` test now fails by design — `MEDIA_FILTER_GQL_TYPES` is a superset (all 71 `Query.Media` args) while `MediaFilterTypesSchema` exposes a curated subset. Delete that test and replace it with:

```ts
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
```

The three hardcoded `LIVE_*` enum lists in that file stay — they are the offline assertion that the generated enums are complete.

- [ ] **Step 7: Verify everything passes**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (44 minus the one deleted, plus the one added = 44).

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-schema.ts utils/schemas.generated.ts utils/schemas.ts \
        utils/anilistGraphql.ts tsconfig.json package.json tests/apiCoverage.test.ts
git commit -m "Generate AniList enums and filter types from introspection"
```

---

### Task 2: Media selection registry

**Files:**
- Create: `utils/mediaSelection.ts`
- Test: `tests/mediaSelection.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent)
- Produces:
  - `MEDIA_GROUPS: Record<MediaGroup, string>`
  - `type MediaGroup` — union of the 14 group names
  - `CORE_SELECTION: string`
  - `POST_FETCH_CAPS: { tags: number; relations: number; streamingEpisodes: number }`
  - `MediaGroupSchema: z.ZodEnum` and `MediaIncludeSchema: z.ZodOptional<z.ZodArray<...>>`
  - `buildMediaSelection(groups?: MediaGroup[]): string`
  - `requiresAuth(groups?: MediaGroup[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/mediaSelection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/mediaSelection.test.ts`
Expected: FAIL — `Cannot find module '../utils/mediaSelection.js'`

- [ ] **Step 3: Write the registry**

Create `utils/mediaSelection.ts`:

```ts
import { z } from "zod";

/**
 * Fields returned for every media request. Bounded by measurement:
 * description 107-403 tok, synonyms 26-107 tok, genres 8-12 tok.
 *
 * status and source are versioned. Selected bare, AniList answers with the
 * legacy v1 enum — every HIATUS title reports RELEASING, and WEB_NOVEL,
 * LIVE_ACTION, GAME, COMIC, MULTIMEDIA_PROJECT and PICTURE_BOOK all
 * collapse to OTHER. These are the highest versions AniList honours;
 * higher numbers silently fall back to v1.
 */
export const CORE_SELECTION = `
  id idMal type format siteUrl isAdult countryOfOrigin
  title { romaji english native userPreferred }
  status(version: 2)
  source(version: 3)
  description genres synonyms
  startDate { year month day }
  endDate { year month day }
  season seasonYear episodes duration chapters volumes
  averageScore meanScore popularity favourites
  coverImage { extraLarge large medium color }
  nextAiringEpisode { airingAt timeUntilAiring episode }
`;

/**
 * Opt-in field groups. Anything with a perPage argument is capped in the
 * query; the rest are capped after the fact via POST_FETCH_CAPS.
 */
export const MEDIA_GROUPS = {
  tags: `tags { id name rank category isMediaSpoiler }`,
  studios: `studios { edges { isMain node { id name isAnimationStudio } } }`,
  characters: `characters(sort: [ROLE, RELEVANCE], perPage: 25) {
    edges { role node { id name { full native } image { medium } }
            voiceActors(language: JAPANESE) { id name { full } } } }`,
  staff: `staff(perPage: 25) { edges { role node { id name { full } } } }`,
  relations: `relations { edges { relationType
    node { id title { romaji english } type format status(version: 2) } } }`,
  recommendations: `recommendations(sort: RATING_DESC, perPage: 10) {
    nodes { rating mediaRecommendation { id title { romaji english } type } } }`,
  // Deliberately no `body`: that single field is 143,970 of the 217,738
  // characters in a full One Piece response. siteUrl reaches the prose.
  reviews: `reviews(sort: RATING_DESC, perPage: 5) {
    nodes { id score summary siteUrl } }`,
  // icon and color are UI chrome (a PNG url and a hex code) and halve the
  // payload for nothing a model can use: 725 -> 360 tok on One Piece.
  links: `externalLinks { url site type language }`,
  // thumbnail dropped for the same reason (5,417 -> 3,503 tok).
  episodes: `streamingEpisodes { title url site }`,
  rankings: `rankings { rank type context year season allTime }`,
  airing: `airingSchedule(notYetAired: true, perPage: 25) {
    nodes { episode airingAt timeUntilAiring } }`,
  stats: `trending stats {
    scoreDistribution { score amount } statusDistribution { status amount } }`,
  viewer: `isFavourite mediaListEntry { id status score progress progressVolumes
    repeat priority private notes
    startedAt { year month day } completedAt { year month day } }`,
  meta: `bannerImage hashtag updatedAt isLicensed seasonInt
    trailer { id site thumbnail }`,
} as const;

export type MediaGroup = keyof typeof MEDIA_GROUPS;

/**
 * AniList accepts no pagination arguments on these three, so they are the
 * only fields trimmed client-side. Uncapped, tags alone is 1,676 tok on
 * One Piece (75 tags) — larger than the entire core selection.
 */
export const POST_FETCH_CAPS = {
  tags: 10,
  relations: 25,
  streamingEpisodes: 10,
} as const;

/** Groups AniList evaluates against a logged-in user. */
const AUTH_REQUIRING_GROUPS: MediaGroup[] = ["viewer"];

export const MediaGroupSchema = z.enum(
  Object.keys(MEDIA_GROUPS) as [MediaGroup, ...MediaGroup[]],
);

export const MediaIncludeSchema = z
  .array(MediaGroupSchema)
  .optional()
  .describe(
    "Extra field groups to fetch. Omit for core fields only (id, titles, " +
      "status, source, dates, episode counts, scores, genres, cover image, " +
      "next airing episode). Options: tags, studios, characters, staff, " +
      "relations, recommendations, reviews (no full text), links (where to " +
      "watch), episodes (per-episode streaming links — PARTIAL and " +
      "Crunchyroll-biased; One Piece has 1177 episodes but AniList carries " +
      "69), rankings, airing (full schedule), stats, viewer ([Requires " +
      "Login] your own list entry), meta.",
  );

export function buildMediaSelection(groups: MediaGroup[] = []): string {
  const unique = [...new Set(groups)];
  return [CORE_SELECTION, ...unique.map((g) => MEDIA_GROUPS[g])].join("\n");
}

export function requiresAuth(groups: MediaGroup[] = []): boolean {
  return groups.some((g) => AUTH_REQUIRING_GROUPS.includes(g));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/mediaSelection.test.ts && npx tsc --noEmit`
Expected: all pass, tsc clean.

Note: the "omits every group that was not requested" test checks for `airingSchedule` and `mediaListEntry` (the GraphQL field names), not `airing`/`viewer` (our group names), because the group name never appears in the query text.

- [ ] **Step 5: Commit**

```bash
git add utils/mediaSelection.ts tests/mediaSelection.test.ts
git commit -m "Add media selection group registry"
```

---

### Task 3: Normalization pipeline

**Files:**
- Create: `utils/mediaNormalize.ts`
- Test: `tests/mediaNormalize.test.ts`

**Interfaces:**
- Consumes: `POST_FETCH_CAPS` from `utils/mediaSelection.js` (Task 2)
- Produces: `normalizeMedia(value: unknown): unknown` — composes unwrap, cap and null-drop. Also exports `unwrapConnections`, `applyCaps` and `dropNulls` individually for testing.

- [ ] **Step 1: Write the failing test**

Create `tests/mediaNormalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  unwrapConnections,
  applyCaps,
  dropNulls,
  normalizeMedia,
} from "../utils/mediaNormalize.js";

describe("unwrapConnections", () => {
  it("replaces a nodes envelope with its array", () => {
    expect(unwrapConnections({ studios: { nodes: [{ id: 1 }] } }))
      .toEqual({ studios: [{ id: 1 }] });
  });

  it("replaces an edges envelope with its array WITHOUT flattening", () => {
    // role must stay beside node, not be merged into it. Merging is
    // restructuring, and restructuring is how anilist-node went wrong.
    expect(unwrapConnections({ characters: { edges: [{ role: "MAIN", node: { id: 7 } }] } }))
      .toEqual({ characters: [{ role: "MAIN", node: { id: 7 } }] });
  });

  it("unwraps recursively", () => {
    expect(unwrapConnections({ a: { nodes: [{ b: { nodes: [{ id: 2 }] } }] } }))
      .toEqual({ a: [{ b: [{ id: 2 }] }] });
  });

  it("leaves an object alone when nodes is not its only key", () => {
    const input = { pageInfo: { total: 1 }, nodes: [{ id: 1 }] };
    expect(unwrapConnections(input)).toEqual(input);
  });

  it("passes through arrays and primitives", () => {
    expect(unwrapConnections([1, 2])).toEqual([1, 2]);
    expect(unwrapConnections("x")).toBe("x");
    expect(unwrapConnections(null)).toBe(null);
  });
});

describe("applyCaps", () => {
  it("keeps the 10 highest-ranked tags", () => {
    const tags = Array.from({ length: 75 }, (_, i) => ({ id: i, name: `t${i}`, rank: i }));
    const out: any = applyCaps({ tags });
    expect(out.tags).toHaveLength(10);
    expect(out.tags[0].rank).toBe(74);
    expect(out.tags[9].rank).toBe(65);
  });

  it("tolerates a null rank", () => {
    const out: any = applyCaps({ tags: [{ id: 1, rank: null }, { id: 2, rank: 50 }] });
    expect(out.tags[0].id).toBe(2);
  });

  it("keeps the most recent 10 streaming episodes", () => {
    const eps = Array.from({ length: 69 }, (_, i) => ({ title: `Episode ${i + 1}` }));
    const out: any = applyCaps({ streamingEpisodes: eps });
    expect(out.streamingEpisodes).toHaveLength(10);
    expect(out.streamingEpisodes[9].title).toBe("Episode 69");
  });

  it("caps relations at 25", () => {
    const rel = Array.from({ length: 60 }, (_, i) => ({ relationType: `R${i}` }));
    expect((applyCaps({ relations: rel }) as any).relations).toHaveLength(25);
  });

  it("leaves uncapped fields untouched", () => {
    const genres = Array.from({ length: 40 }, (_, i) => `g${i}`);
    expect((applyCaps({ genres }) as any).genres).toHaveLength(40);
  });
});

describe("dropNulls", () => {
  it("removes null and undefined keys recursively", () => {
    expect(dropNulls({ a: 1, b: null, c: { d: null, e: 2 } }))
      .toEqual({ a: 1, c: { e: 2 } });
  });

  it("keeps falsy values that are not null", () => {
    expect(dropNulls({ a: 0, b: "", c: false })).toEqual({ a: 0, b: "", c: false });
  });

  it("cleans objects inside arrays", () => {
    expect(dropNulls({ xs: [{ a: 1, b: null }] })).toEqual({ xs: [{ a: 1 }] });
  });
});

describe("normalizeMedia", () => {
  it("unwraps, caps and drops nulls in one pass", () => {
    const input = {
      id: 21,
      episodes: null,
      studios: { edges: [{ isMain: true, node: { id: 18, name: "Toei" } }] },
      tags: Array.from({ length: 30 }, (_, i) => ({ id: i, rank: i })),
    };
    const out: any = normalizeMedia(input);
    expect(out.episodes).toBeUndefined();
    expect(out.studios).toEqual([{ isMain: true, node: { id: 18, name: "Toei" } }]);
    expect(out.tags).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/mediaNormalize.test.ts`
Expected: FAIL — `Cannot find module '../utils/mediaNormalize.js'`

- [ ] **Step 3: Write the implementation**

Create `utils/mediaNormalize.ts`:

```ts
import { POST_FETCH_CAPS } from "./mediaSelection.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strip GraphQL connection envelopes: any object whose ONLY key is `nodes`
 * or `edges` becomes that array. Structural rather than declared, so there
 * is no second list of field names to drift out of sync.
 *
 * This unwraps the envelope and nothing else. `{ edges: [{ role, node }] }`
 * becomes `[{ role, node }]` — `role` is never merged into `node`, because
 * that is restructuring, and restructuring is the mistake this replaces.
 */
export function unwrapConnections(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapConnections);
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value);
  if (keys.length === 1 && (keys[0] === "nodes" || keys[0] === "edges")) {
    return unwrapConnections(value[keys[0]]);
  }

  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, unwrapConnections(v)]),
  );
}

/**
 * Trim the three fields AniList will not paginate server-side. Applied
 * after unwrapping so the values are already arrays.
 */
export function applyCaps(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const out = { ...value };

  if (Array.isArray(out.tags)) {
    out.tags = [...(out.tags as Array<{ rank?: number | null }>)]
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, POST_FETCH_CAPS.tags);
  }

  if (Array.isArray(out.relations)) {
    out.relations = (out.relations as unknown[]).slice(0, POST_FETCH_CAPS.relations);
  }

  // AniList returns these in ascending episode order, so the most recent
  // are at the end.
  if (Array.isArray(out.streamingEpisodes)) {
    out.streamingEpisodes = (out.streamingEpisodes as unknown[]).slice(
      -POST_FETCH_CAPS.streamingEpisodes,
    );
  }

  return out;
}

/** Recursively remove null/undefined values to keep payloads lean. */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    out[k] = dropNulls(v);
  }
  return out;
}

/** Full pipeline for one media object. Order matters: caps need arrays. */
export function normalizeMedia(value: unknown): unknown {
  return dropNulls(applyCaps(unwrapConnections(value)));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/mediaNormalize.test.ts && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add utils/mediaNormalize.ts tests/mediaNormalize.test.ts
git commit -m "Add media normalization pipeline"
```

---

### Task 4: getMediaDirect with id_in batching

**Files:**
- Modify: `utils/anilistGraphql.ts` (append after `searchMediaDirect`)
- Test: `tests/getMedia.test.ts`

**Interfaces:**
- Consumes: `buildMediaSelection`, `requiresAuth`, `MediaGroup` (Task 2); `normalizeMedia` (Task 3); existing `postGraphQL` in `utils/anilistGraphql.ts`
- Produces: `getMediaDirect(type: "ANIME" | "MANGA", ids: number[], groups: MediaGroup[], token?: string): Promise<{ media: unknown[]; notFound: number[] }>`

- [ ] **Step 1: Write the failing test**

Create `tests/getMedia.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/getMedia.test.ts`
Expected: FAIL — `getMediaDirect is not a function`

- [ ] **Step 3: Implement getMediaDirect**

Add to the imports at the top of `utils/anilistGraphql.ts`:

```ts
import {
  buildMediaSelection,
  requiresAuth,
  type MediaGroup,
} from "./mediaSelection.js";
import { normalizeMedia } from "./mediaNormalize.js";
```

Append to the end of `utils/anilistGraphql.ts`:

```ts
/**
 * Fetch one or more media records by AniList id.
 *
 * Uses Page(media(id_in:)) rather than one Media(id:) call per id: eight ids
 * come back in a single 238ms request instead of eight requests against an
 * API currently degraded to 30/min with a burst limiter on top.
 *
 * Ids AniList does not return are reported in `notFound` rather than throwing,
 * so one bad id no longer costs the whole call.
 */
export async function getMediaDirect(
  type: "ANIME" | "MANGA",
  ids: number[],
  groups: MediaGroup[] = [],
  token?: string,
): Promise<{ media: unknown[]; notFound: number[] }> {
  const selection = buildMediaSelection(groups);

  const query = `
    query ($ids: [Int], $perPage: Int, $type: MediaType) {
      Page(page: 1, perPage: $perPage) {
        media(id_in: $ids, type: $type) {
          ${selection}
        }
      }
    }
  `;

  const trimmedToken = token?.trim() || undefined;
  const data = await postGraphQL(
    query,
    { ids, perPage: Math.min(ids.length, 50), type },
    requiresAuth(groups) ? trimmedToken : undefined,
  );

  const page = data.Page as { media?: unknown[] } | undefined;
  if (!page?.media) {
    throw new Error("Unexpected response from AniList API");
  }

  const byId = new Map<number, unknown>();
  for (const item of page.media) {
    const id = (item as { id?: number }).id;
    if (typeof id === "number") byId.set(id, normalizeMedia(item));
  }

  return {
    media: ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!),
    notFound: ids.filter((id) => !byId.has(id)),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/getMedia.test.ts && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 5: Verify against the live API**

Create a throwaway file `_check.mts` in the project root:

```ts
import { getMediaDirect } from "./utils/anilistGraphql.js";
const out: any = await getMediaDirect("ANIME", [21, 154587, 999999999], ["studios"]);
console.log("notFound:", out.notFound);
console.log("order:", out.media.map((m: any) => m.id));
console.log("status/source:", out.media.map((m: any) => `${m.status}/${m.source}`));
console.log("studios[0]:", JSON.stringify(out.media[0].studios?.[0]));
console.log("core tokens:", Math.round(JSON.stringify(out.media[0]).length / 4));
```

Run: `npx tsx ./_check.mts; rm -f ./_check.mts`
Expected: `notFound: [ 999999999 ]`, `order: [ 21, 154587 ]`, statuses populated, `studios[0]` shaped `{"isMain":...,"node":{...}}`, core under ~1500 tokens.

- [ ] **Step 6: Commit**

```bash
git add utils/anilistGraphql.ts tests/getMedia.test.ts
git commit -m "Add getMediaDirect with id_in batching and partial-success reporting"
```

---

### Task 5: Rewire get_anime and get_manga

**Files:**
- Modify: `tools/media.ts` — replace both `ids`/`fullData` handlers
- Modify: `tools/index.ts` — `registerMediaTools` no longer needs `anilist` for these two, but keeps it for the favourite tools; no signature change
- Delete: `utils/mediaFilter.ts`, `tests/mediaFilter.test.ts`
- Delete: `utils/concurrency.ts`, `tests/concurrency.test.ts`
- Test: existing `tests/getMedia.test.ts` covers the data path

**Interfaces:**
- Consumes: `getMediaDirect` (Task 4), `MediaIncludeSchema` and `MediaGroup` (Task 2)
- Produces: no new exports

- [ ] **Step 1: Replace the get_anime handler**

In `tools/media.ts`, replace the imports on lines 6–7:

```ts
import { getMediaDirect } from "../utils/anilistGraphql.js";
import { MediaIncludeSchema, type MediaGroup } from "../utils/mediaSelection.js";
```

Delete `const MAX_PARALLEL_MEDIA_REQUESTS = 3;` and its comment block (lines 9–12) — `id_in` batching removes the fan-out it was bounding.

Replace the `get_anime` tool registration (lines 21–74) with:

```ts
  server.tool(
    "get_anime",
    "Get information about anime by AniList ID(s). Returns core fields by " +
      "default; use `include` to request extra field groups.",
    {
      ids: z
        .union([z.number(), z.array(z.number()).min(1).max(50)])
        .describe("The AniList ID or array of IDs of the anime (max 50)"),
      include: MediaIncludeSchema,
    },
    {
      title: "Get Anime Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ ids, include }) => {
      try {
        const idArray = Array.isArray(ids) ? ids : [ids];
        const result = await getMediaDirect(
          "ANIME",
          idArray,
          (include ?? []) as MediaGroup[],
          config.anilistToken,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
```

- [ ] **Step 2: Replace the get_manga handler**

Apply the same replacement to the `get_manga` registration (lines 162–203), with `"get_manga"`, `"MANGA"`, `"Get Manga Details"`, and description/`ids` text saying manga.

- [ ] **Step 3: Delete the superseded modules**

```bash
git rm utils/mediaFilter.ts tests/mediaFilter.test.ts \
       utils/concurrency.ts tests/concurrency.test.ts
```

`mediaFilter` existed only to discard ~96% of an over-fetched payload after it arrived; the query now fetches the right fields. `concurrency` bounded a per-id fan-out that `id_in` batching removes.

- [ ] **Step 4: Verify nothing still imports them**

Run: `grep -rn "mediaFilter\|concurrency\|filterMedia\|mapWithConcurrency\|fullData" --include="*.ts" . | grep -v node_modules | grep -v docs/`
Expected: no output. If `tools/media.ts` still references `filterMedia` or `FilteredMediaEntry`, remove those references.

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all remaining tests pass.

- [ ] **Step 6: Verify through the real MCP server**

```bash
npx tsc && cat > ./_e2e.mts <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const c = new Client({ name: "check", version: "1.0.0" });
await c.connect(t);
const call = async (n: string, a: any) => {
  const r: any = await c.callTool({ name: n, arguments: a });
  return JSON.parse(r.content[0].text);
};
const core = await call("get_anime", { ids: 21 });
console.log("core tokens:", Math.round(JSON.stringify(core).length / 4));
console.log("notFound:", core.notFound, "| status/source:",
  core.media[0].status, core.media[0].source);
console.log("no tags in core:", core.media[0].tags === undefined);
const withTags = await call("get_anime", { ids: 21, include: ["tags"] });
console.log("with tags:", withTags.media[0].tags.length, "tags,",
  Math.round(JSON.stringify(withTags).length / 4), "tokens");
await c.close();
EOF
npx tsx ./_e2e.mts; rm -f ./_e2e.mts
```

Expected: core under ~1500 tokens (down from ~1314 filtered / 54,435 full), `notFound: []`, `status`/`source` populated, `no tags in core: true`, tags capped at 10.

- [ ] **Step 7: Commit**

```bash
git add tools/media.ts
git commit -m "Rewire get_anime/get_manga onto getMediaDirect; delete mediaFilter and concurrency"
```

---

### Task 6: Search adopts the shared builder

**Files:**
- Modify: `utils/anilistGraphql.ts` — `searchMediaDirect` takes `groups`, uses `buildMediaSelection`
- Modify: `tools/search.ts` — `search_anime` and `search_manga` gain `include`
- Test: `tests/search.test.ts` (update), `tests/auth.test.ts` (update signature calls)

**Interfaces:**
- Consumes: `buildMediaSelection`, `requiresAuth`, `MediaIncludeSchema`, `MediaGroup` (Task 2); `normalizeMedia` (Task 3)
- Produces: `searchMediaDirect(type, term, filter, page, perPage, groups?, token?)` — **note `groups` is inserted before `token`**; every existing call site must be updated.

- [ ] **Step 1: Update searchMediaDirect**

In `utils/anilistGraphql.ts`, change the signature and selection. Replace the inline field list in the `query` template (the block from `id idMal` through `siteUrl`) with `${buildMediaSelection(groups)}`, and change the signature to:

```ts
export async function searchMediaDirect(
  type: "ANIME" | "MANGA",
  term: string | undefined,
  filter: Record<string, unknown> | undefined,
  page: number,
  perPage: number,
  groups: MediaGroup[] = [],
  token?: string,
): Promise<unknown> {
```

Update the auth decision to cover both sources — the `onList` filter and the `viewer` group:

```ts
  const trimmedToken = token?.trim() || undefined;
  const needsAuth =
    AUTH_REQUIRING_MEDIA_FILTERS.some(
      (k) => filter?.[k] !== undefined && filter?.[k] !== null,
    ) || requiresAuth(groups);
```

Normalize the page before returning, so search and get return identical shapes:

```ts
  const page_ = data.Page as { pageInfo?: unknown; media?: unknown[] } | undefined;
  if (!page_?.media) throw new Error("Unexpected response from AniList API");
  return {
    pageInfo: page_.pageInfo,
    media: page_.media.map(normalizeMedia),
  };
```

- [ ] **Step 2: Add include to both search tools**

In `tools/search.ts`, add to the imports:

```ts
import { MediaIncludeSchema, type MediaGroup } from "../utils/mediaSelection.js";
```

In the `search_anime` parameter object, add `include: MediaIncludeSchema,` immediately after `...MediaFilterFields,`. Change the handler signature to `async ({ term, page, amount, include, ...filterFields })` and the call to:

```ts
        const results = await searchMediaDirect(
          "ANIME",
          term,
          buildFilter(filterFields as Record<string, unknown>),
          page,
          amount,
          (include ?? []) as MediaGroup[],
          config.anilistToken,
        );
```

Apply the same three changes to `search_manga` with `"MANGA"`.

- [ ] **Step 3: Update the existing test call sites**

`tests/search.test.ts` and `tests/auth.test.ts` call `searchMediaDirect(...)` with the token in position 6. Every such call must gain `[]` for `groups` before the token. For example, in `tests/auth.test.ts`:

```ts
await searchMediaDirect("ANIME", "naruto", undefined, 1, 5, [], "some-token");
await searchMediaDirect("ANIME", undefined, { onList: true }, 1, 5, [], "some-token");
```

Calls that pass no token (e.g. `searchMediaDirect("ANIME", undefined, undefined, 1, 5)`) need no change.

In `tests/search.test.ts`, the `"returns the Page object from the response"` test now receives a normalized `{ pageInfo, media }` rather than the raw page, so change it to:

```ts
  it("returns pageInfo and normalized media", async () => {
    const result: any = await searchMediaDirect(
      "ANIME", undefined, { season: "SPRING", seasonYear: 2026 }, 1, 5,
    );
    expect(result.pageInfo).toEqual(MOCK_PAGE_RESPONSE.pageInfo);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].id).toBe(999);
  });
```

- [ ] **Step 4: Add a test for search include groups**

Append to `tests/search.test.ts`:

```ts
describe("search selection groups", () => {
  it("returns core only when no include is given", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(MOCK_PAGE_RESPONSE));
    await searchMediaDirect("ANIME", "x", undefined, 1, 5);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.query).not.toContain("tags {");
    expect(body.query).not.toContain("studios {");
    expect(body.query).not.toContain("streamingEpisodes");
    vi.unstubAllGlobals();
  });

  it("includes a requested group", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(MOCK_PAGE_RESPONSE));
    await searchMediaDirect("ANIME", "x", undefined, 1, 5, ["studios"]);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.query).toContain("studios {");
    expect(body.query).not.toContain("reviews");
    vi.unstubAllGlobals();
  });

  it("authenticates for the viewer group", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(MOCK_PAGE_RESPONSE));
    await searchMediaDirect("ANIME", "x", undefined, 1, 5, ["viewer"], "tok");
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer tok");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Verify shapes now match**

```bash
npx tsc && cat > ./_shape.mts <<'EOF'
import { getMediaDirect, searchMediaDirect } from "./utils/anilistGraphql.js";
const g: any = await getMediaDirect("ANIME", [21], ["studios", "links"]);
await new Promise(r => setTimeout(r, 1200));
const s: any = await searchMediaDirect("ANIME", "One Piece", { id: 21 }, 1, 1, ["studios", "links"]);
for (const f of ["studios", "links", "externalLinks"]) {
  console.log(f, "\n  get:   ", JSON.stringify(g.media[0][f])?.slice(0, 80),
              "\n  search:", JSON.stringify(s.media[0][f])?.slice(0, 80));
}
EOF
npx tsx ./_shape.mts; rm -f ./_shape.mts
```

Expected: `get` and `search` print byte-identical shapes for each field.

- [ ] **Step 7: Commit**

```bash
git add utils/anilistGraphql.ts tools/search.ts tests/search.test.ts tests/auth.test.ts
git commit -m "Search adopts the shared selection builder; unify response shape with get_anime"
```

---

### Task 7: Token budget and live tests

**Files:**
- Create: `tests/fixtures/one-piece-full.json`
- Create: `tests/tokenBudget.test.ts`
- Create: `tests/live.test.ts`

**Interfaces:**
- Consumes: `normalizeMedia` (Task 3), `getMediaDirect`/`searchMediaDirect` (Tasks 4, 6), `MediaSourceSchema` and `MEDIA_FILTER_GQL_TYPES` (Task 1)
- Produces: no exports

- [ ] **Step 1: Capture the fixture**

```bash
mkdir -p tests/fixtures && cat > ./_fx.mts <<'EOF'
import { buildMediaSelection } from "./utils/mediaSelection.js";
import { writeFileSync } from "node:fs";
const groups = ["tags","studios","characters","staff","relations","recommendations",
                "reviews","links","episodes","rankings","airing","stats","meta"] as const;
const q = `query { Page(page:1, perPage:1) { media(id_in:[21], type:ANIME) {
  ${buildMediaSelection([...groups] as any)} } } }`;
const r = await fetch("https://graphql.anilist.co", { method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ query: q }) });
const j: any = await r.json();
if (j.errors) { console.error(JSON.stringify(j.errors, null, 2)); process.exit(1); }
writeFileSync("tests/fixtures/one-piece-full.json",
  JSON.stringify(j.data.Page.media[0], null, 2));
console.log("captured, raw chars:", JSON.stringify(j.data.Page.media[0]).length);
EOF
npx tsx ./_fx.mts; rm -f ./_fx.mts
```

Expected: the file is written and the raw size prints. Note the `viewer` group is deliberately excluded — it needs auth and would be null anyway.

- [ ] **Step 2: Write the budget test**

Create `tests/tokenBudget.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Write the live tests**

Create `tests/live.test.ts`:

```ts
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
```

- [ ] **Step 4: Run both, offline then live**

Run: `npx vitest run tests/tokenBudget.test.ts`
Expected: 4 pass.

Run: `npx vitest run tests/live.test.ts`
Expected: 4 skipped.

Run: `ANILIST_LIVE=1 npx vitest run tests/live.test.ts`
Expected: 4 pass. If the schema-freshness test fails, run `pnpm run sync-schema`, review the printed diff, and commit the regenerated file.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/one-piece-full.json tests/tokenBudget.test.ts tests/live.test.ts
git commit -m "Add token budget guard and opt-in live schema tests"
```

---

### Task 8: Version bump and documentation

**Files:**
- Modify: `package.json`, `index.ts`, `manifest.json`, `Dockerfile`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Bump the version in all four places**

`package.json`: `"version": "2.0.0"`
`index.ts`: in `createServer`, `version: "2.0.0"`
`manifest.json`: top-level `"version": "2.0.0"`
`Dockerfile`: `LABEL org.opencontainers.image.version="2.0.0"`

Run: `grep -rn '1\.4\.0' package.json index.ts manifest.json Dockerfile`
Expected: no output.

- [ ] **Step 2: Sync the manifest tool descriptions**

`manifest.json` lists each tool's description and `get_anime`/`get_manga` changed. Update those two entries to match the strings used in `tools/media.ts`:

```json
{ "name": "get_anime",
  "description": "Get information about anime by AniList ID(s). Returns core fields by default; use `include` to request extra field groups." },
{ "name": "get_manga",
  "description": "Get information about manga by AniList ID(s). Returns core fields by default; use `include` to request extra field groups." },
```

- [ ] **Step 3: Document the breaking changes in the README**

Add a section directly after the features list:

```markdown
## Breaking changes in 2.0.0

`get_anime` / `get_manga` no longer take `fullData`. They return core fields by
default and accept `include` for extra field groups:

    get_anime({ ids: 21 })                          // core only
    get_anime({ ids: 21, include: ["characters"] }) // core + characters

Both now return a uniform envelope — `{ media: [...], notFound: [...] }` — for
one id or many. Ids AniList does not return are listed in `notFound` rather
than throwing.

`search_anime` / `search_manga` accept the same `include`, and return core
fields only unless asked. They previously always returned tags, studios,
external links, streaming episodes and rankings.

Response shape changes:

| Field | 1.x | 2.0 |
|---|---|---|
| `coverImage.large` | AniList's `extraLarge` | AniList's `large` (smaller image) |
| `coverImage.small` | AniList's `medium` | removed; keys are `extraLarge`/`large`/`medium` |
| `studios` | `[{id,name,isAnimationStudio}]` | `[{isMain, node:{...}}]`, opt-in |
| `externalLinks` | `["https://..."]` | `[{url,site,type,language}]`, opt-in as `links` |
| `status` / `source` | legacy v1 enum | versioned — corrects wrong values |

`coverImage.large` is the one to watch: 1.x aliased AniList's `extraLarge` to
`large`, so the same key now returns a smaller image without erroring.
```

- [ ] **Step 4: Verify the whole suite and a clean build**

Run: `rm -rf dist && npx tsc --noEmit && npm run build && npx vitest run`
Expected: tsc clean, build succeeds, all tests pass.

Run: `find dist -name "*.test.js" -o -name "sync-schema.js" | head`
Expected: no output — neither tests nor scripts ship in `dist`.

- [ ] **Step 5: Commit**

```bash
git add package.json index.ts manifest.json Dockerfile README.md
git commit -m "Bump to 2.0.0 and document the breaking tool contract"
```

---

## Deployment (after review and merge)

Not a task — run this once the PR is merged, following the procedure validated 2026-09-05:

```bash
ssh -i ~/.ssh/chi_home_ed25519 zaraki@192.168.1.154
sudo docker tag anilist-mcp:local anilist-mcp:rollback-$(date +%Y%m%d)
sudo docker inspect anilist-mcp --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(ANILIST_TOKEN|PORT|TRANSPORT)=' > /tmp/anilist.env
sudo chmod 600 /tmp/anilist.env
sudo git -C /opt/anilist-mcp fetch origin --quiet
sudo git -C /opt/anilist-mcp reset --hard origin/main --quiet
cd /opt/anilist-mcp && sudo docker build -t anilist-mcp:local .
# verify the IMAGE before swapping:
sudo docker run --rm --entrypoint sh anilist-mcp:local -c \
  'grep -c "version: 2" dist/utils/mediaSelection.js; test -f dist/utils/mediaNormalize.js && echo ok'
sudo docker stop anilist-mcp && sudo docker rm anilist-mcp
sudo docker run -d --name anilist-mcp --restart unless-stopped \
  --network ai-stack_default -p 9556:8081 --env-file /tmp/anilist.env anilist-mcp:local
sudo rm -f /tmp/anilist.env
```

Then extend the verification script from the 2026-09-05 deploy to cover `include` groups, `notFound`, and token ceilings; update the BookStack Maintenance Log (page 41, book 8); and update `project_anilist_mcp.md` in memory.

Rollback: `sudo docker tag anilist-mcp:rollback-<date> anilist-mcp:local` then recreate.

Note the gateway container is `openclaw-openclaw-gateway-1`, not `openclaw-gateway`.
