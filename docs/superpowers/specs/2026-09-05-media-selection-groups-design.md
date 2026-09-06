# Media Selection Groups — Design

**Date:** 2026-09-05
**Status:** Approved, not yet implemented
**Scope:** Replace `anilist-node`'s hardcoded media query with runtime-assembled GraphQL selection sets, shared by `get_anime`, `get_manga`, `search_anime` and `search_manga`.

## Problem

`anilist-node` hardcodes one GraphQL query string per media type, with every field baked in — including `reviews { nodes { body } }`. GraphQL exists so the *client* chooses fields; the library freezes that choice at authoring time, rebuilding a REST endpoint on top of GraphQL. Three consequences:

1. **You always pay for everything.** `get_anime(21)` returns 217,738 characters (~54,000 tokens); 143,970 of that is review prose. `utils/mediaFilter.ts` exists solely to discard ~96% of it *after* it crossed the wire.
2. **You cannot ask for anything the string lacks.** `status` and `source` are versioned enums. Selected bare, AniList answers with the legacy v1 set: every `HIATUS` title reports `RELEASING`, and the six newer `MediaSource` values collapse to `OTHER`. The fix is adding `(version: N)` inside a string we don't control.
3. **Hand-written reshaping drifts from reality.** `formatMedia()` aliases `extraLarge → large` and `full → english`, and the hand-written `.d.ts` declares `nextAiringEpisode: AiringEntry[]` when AniList returns an object — which silently dropped that field for every airing show.

For an MCP server the scarce resource is context, so over-fetching is not a performance footnote — it is the dominant cost of the tool.

## Decisions

| # | Decision |
|---|---|
| 1 | Callers opt into extras by name: `include: ["characters", "reviews"]`. Default returns core only. `fullData` is removed. |
| 2 | Output keeps AniList's real field names and values. Connection envelopes (`{nodes}`/`{edges}`) are unwrapped; nothing is renamed, merged, or reinterpreted. Null-valued keys are dropped. |
| 3 | One shared builder serves media and search. Both return identical shapes for the same title. |
| 4 | Viewer-scoped fields (`mediaListEntry`, `isFavourite`) live in an opt-in `viewer` group that authenticates only when requested. |
| 5 | AniList enums and `MEDIA_FILTER_GQL_TYPES` are generated from schema introspection, not hand-maintained. |
| 6 | Version bumps to `2.0.0` — this is a breaking tool-contract change. |

### Rejected: schema codegen for queries

`gql.tada` / graphql-codegen would have caught 5 of the 10 bugs found in the 2026-09-05 review — the silent ones (enum gaps, the `AiringEntry[]` type lie, filter-map drift). AniList's schema is small (0.42 MB, 196 types, 42 enums), so size was not the obstacle.

The obstacle is structural: codegen's value is verifying a query known **at compile time**, while this design assembles selection sets **at runtime**. One static query per include-combination is 2^N queries; one maximal query types absent fields as present. Fragment composition gets close but a runtime-chosen fragment set collapses to a union, keeping the types and losing the guarantee.

Decision 5 takes the half that *is* static — enums and filter-arg types — and leaves query assembly dynamic.

## Architecture

```
utils/mediaSelection.ts     group registry, core selection, caps, include schema  [new]
utils/mediaNormalize.ts     unwrap envelopes, apply caps, drop nulls              [new]
utils/anilistGraphql.ts     + getMediaDirect(); searchMediaDirect() uses builder
utils/schemas.generated.ts  generated enums + MEDIA_FILTER_GQL_TYPES             [new]
scripts/sync-schema.ts      introspects AniList, writes the above                [new]
utils/mediaFilter.ts        DELETED (225 lines)
utils/concurrency.ts        DELETED (superseded by id_in batching)
```

### Data flow

```
get_anime({ ids: [21, 5], include: ["studios"] })
  │
  ├─ buildMediaSelection(["studios"]) ──► CORE + studios fragment
  │
  ├─ query ($ids:[Int], $perPage:Int) {
  │    Page(page:1, perPage:$perPage) {
  │      media(id_in:$ids, type:ANIME) { <selection> } } }
  │
  ├─ postGraphQL(query, vars, groups.includes("viewer") ? token : undefined)
  │
  └─ unwrapConnections → applyCaps → dropNulls → reorder to request order
```

### Response envelope

`get_anime` / `get_manga` always return a uniform envelope, regardless of whether
`ids` was a single number or an array:

```json
{ "media": [ { "id": 21, ... } ], "notFound": [] }
```

Today the tool returns a bare object for a single id and an array for several —
two shapes from one tool, which is the same inconsistency this design removes
between `get_anime` and `search_anime`. Since 2.0 is breaking anyway, uniformity
wins; the caller reads `media[0]`. `notFound` lists requested ids AniList did not
return, and is `[]` rather than omitted so its absence is never ambiguous.

`search_anime` / `search_manga` keep AniList's `Page` envelope
(`{ pageInfo, media }`). Both tool families expose the results under `media`.

`media(id_in:)` fetches every requested id in **one** request (measured: 8 ids, 238 ms) versus today's per-id fan-out (measured: 1.4 s across 3 concurrent). This removes the rate-limit hazard that `utils/concurrency.ts` was added to bound, so that module goes.

`unwrapConnections` is structural: any object whose only key is `nodes` or `edges` becomes that array, recursively. Nothing is declared, so nothing can drift.

**Unwrapping is not flattening.** `characters { edges { role node {…} } }` becomes `[{ role, node: {…} }]`. `role` is *not* merged into the node — restructuring is how the library got where it is.

## Field groups

**Core** (always returned):

```
id idMal type format siteUrl isAdult countryOfOrigin
title { romaji english native userPreferred }
status(version: 2)   source(version: 3)
description  genres  synonyms
startDate/endDate { year month day }  season seasonYear
episodes duration chapters volumes
averageScore meanScore popularity favourites
coverImage { extraLarge large medium color }
nextAiringEpisode { airingAt timeUntilAiring episode }
```

Measured: `description` 107–403 tok, `synonyms` 26–107 tok, `genres` 8–12 tok. All bounded; core stays uncapped.

**Groups:**

| Group | Contents | Cap |
|---|---|---|
| `tags` | `tags { id name rank category isMediaSpoiler }` | client, top 10 by rank desc |
| `studios` | `studios { edges { isMain node { id name isAnimationStudio } } }` | — |
| `characters` | `characters(sort:[ROLE,RELEVANCE], perPage:25) { edges { role node {…} voiceActors(language:JAPANESE) {…} } }` | server |
| `staff` | `staff(perPage:25) { edges { role node { id name { full } } } }` | server |
| `relations` | `relations { edges { relationType node { id title type format status(version:2) } } }` | client, 25 |
| `recommendations` | `recommendations(sort:RATING_DESC, perPage:10) { nodes {…} }` | server |
| `reviews` | `reviews(sort:RATING_DESC, perPage:5) { nodes { id score summary siteUrl } }` | server |
| `links` | `externalLinks { url site type language }` | — |
| `episodes` | `streamingEpisodes { title url site }` | client, most recent 10 |
| `rankings` | `rankings { rank type context year season allTime }` | — |
| `airing` | `airingSchedule(notYetAired:true, perPage:25) { nodes {…} }` | server |
| `stats` | `stats { scoreDistribution {…} statusDistribution {…} }`, `trending` | — |
| `viewer` | `mediaListEntry {…}`, `isFavourite` — **authenticated** | — |
| `meta` | `bannerImage hashtag trailer {…} updatedAt isLicensed seasonInt` | — |

### Why these caps

`tags`, `relations`, `streamingEpisodes` and `externalLinks` accept no server-side pagination arguments, so they are the only fields trimmed client-side.

- **`tags` uncapped is 1,676 tok on One Piece (75 tags) — larger than the entire core.** Top 10 by rank is 225 tok and stays flat across titles.
- **`streamingEpisodes` is 5,417 tok on One Piece**, 3,503 without `thumbnail` (dropped — image URLs are meaningless to a model), 521 for the last 10.
- `relations` is 13,906 characters on One Piece.

Dropped as UI chrome: `externalLinks.icon` / `.color` (halves that field: 725 → 360 tok), `streamingEpisodes.thumbnail`.

`reviews` deliberately omits `body` — one field is 144k of the 217k. `summary` and `score` answer "is it good"; `siteUrl` reaches the prose.

**`episodes` group description must state the list is partial and Crunchyroll-biased.** One Piece has 1,177 episodes; AniList carries 69, starting at episode 130. A model seeing 69 entries could reasonably conclude only 69 exist.

## Schema sync

`pnpm run sync-schema` introspects AniList and writes `utils/schemas.generated.ts`: the 13 mirrored enums plus `MEDIA_FILTER_GQL_TYPES` derived from `Query.Media`'s 71 args. The script carries a name map where ours differ (our `EntryStatusSchema` is AniList's `MediaListStatus`) and prints a diff when anything changes.

Hand-written and *not* generated: `MediaFilterTypesSchema`, `UpdateEntryOptionsSchema`, `UserOptionsInputSchema`. These encode choices — which filters to expose, and the descriptions the model reads — not schema facts.

Consequence: `MEDIA_FILTER_GQL_TYPES` becomes a superset of what we expose, which is harmless because `searchMediaDirect` only emits keys present in the filter object. Adding a filter becomes a one-place edit.

The existing bidirectional drift test becomes one-directional — every exposed filter must exist in AniList's real schema. That is a stronger assertion than the current one, which compares two hand-written maps.

The raw introspection JSON is deliberately not vendored; the generated `.ts` is the diffable artifact.

## Breaking changes

| Field | Today | After |
|---|---|---|
| `coverImage.large` | AniList's `extraLarge` | AniList's `large` — **same key, smaller image** |
| `coverImage.small` | AniList's `medium` | gone; keys are `extraLarge`/`large`/`medium` |
| `studios` | `[{id,name,isAnimationStudio}]` | `[{isMain, node:{…}}]`, opt-in |
| `externalLinks` | `["https://…"]` | `[{url,site,type,language}]`, opt-in as `links` |
| `tags` | top 5 | top 10 by rank, opt-in, adds `rank`/`category` |
| `status` / `source` | legacy enum | versioned — **corrects wrong data** |
| `fullData` | boolean | removed; Zod strips it, so callers get core only |
| response envelope | bare object (1 id) or array (many) | always `{ media: [...], notFound: [...] }` |
| `notFound` | n/a | new key listing requested ids AniList did not return |
| `search_*` default | core + tags/studios/links/episodes/rankings | core only unless `include` |

`coverImage.large` is the trap: every other change either errors loudly or is opt-in. That one keeps its key and quietly returns a smaller image, because the library aliased `extraLarge → large` all along.

Missing ids become partial success rather than a thrown 404 — better behavior, but a contract change. A single-id lookup that finds nothing now returns `{ media: [], notFound: [id] }` instead of throwing.

## Testing

Deleted: `tests/mediaFilter.test.ts`, `tests/concurrency.test.ts`.

1. **Selection builder** (pure) — the guarantee is negative: an unrequested group must not appear in the query text. Plus dedupe, unknown-group rejection, and core carrying `status(version: 2)` / `source(version: 3)`.
2. **Normalization** (pure) — envelope unwrapping *without* flattening (`[{role, node}]`, never `[{role, ...node}]`); nested unwrapping; objects with `nodes` plus other keys left alone; the three client caps; recursive null-dropping.
3. **Query construction** (mocked fetch) — N ids produce exactly one request; `viewer` sends `Authorization` and nothing else does; request order preserved; `notFound` populated.
4. **Token budget** — one committed realistic fixture, normalized, asserted under generous ceilings (core < 1,500 tok). Exists to catch a future `reviews.body` creeping back into core.
5. **Live, opt-in** (`ANILIST_LIVE=1`, never CI) — schema freshness; real round-trips; and **versioned enum values** (Vagabond returns `HIATUS`, Solo Leveling returns `WEB_NOVEL`). Layers 1–4 can only prove we *ask* for `version: 2`; only this proves the value is right. The offline test would have passed all along while the data was wrong.

Still untestable without a token: the authenticated write paths, `customLists` replacement semantics especially.

## Deployment

Procedure validated 2026-09-05: tag current image `anilist-mcp:rollback-<date>`; capture env from the running container to a `600` env-file; pull `/opt/anilist-mcp`; build; **verify the image before swapping**; recreate with `--restart unless-stopped --network ai-stack_default -p 9556:8081 --env-file`; run the verification script; delete the env file. Rollback is `docker tag anilist-mcp:rollback-<date> anilist-mcp:local` plus recreate.

The verification script extends from 7 checks to cover include groups, `notFound`, and token ceilings.

Then: BookStack Maintenance Log, CLAUDE.md if anything moves, project memory.

## Out of scope

- Removing `anilist-node` entirely — people, user, activity, thread, recommendation and misc tools still use it.
- The `search_anime` / `search_manga` input schema size (~2k tokens each, 67 top-level filter properties). Separate decision about tool-surface budget.
