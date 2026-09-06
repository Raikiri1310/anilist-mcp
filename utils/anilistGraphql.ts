import { MEDIA_FILTER_GQL_TYPES } from "./schemas.generated.js";
import {
  buildMediaSelection,
  requiresAuth,
  type MediaGroup,
} from "./mediaSelection.js";
import { normalizeMedia } from "./mediaNormalize.js";

const ANILIST_API = "https://graphql.anilist.co";
const REQUEST_TIMEOUT_MS = 15_000;

// Re-exported so the suite can assert the two stay in step: searchMediaDirect
// only emits keys present here, so a field added to the Zod schema alone
// would be accepted and then silently dropped.
export { MEDIA_FILTER_GQL_TYPES };

// The only media filters AniList evaluates against a logged-in user. Every
// other filter — and every field selected below — is fully public.
const AUTH_REQUIRING_MEDIA_FILTERS = ["onList"];

/**
 * POST a query to AniList and return its `data` object.
 *
 * AniList reports auth and validation failures as a non-2xx status with a
 * useful JSON body (e.g. 400 `{"errors":[{"message":"Invalid token"}]}`), so
 * the body is read before falling back to the bare status line — otherwise
 * every such failure reaches the caller as an undiagnosable "400 Bad Request".
 */
async function postGraphQL(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(ANILIST_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let json:
    | { data?: Record<string, unknown> | null; errors?: Array<{ message?: string }> }
    | undefined;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  const apiMessage = json?.errors?.find((e) => e.message)?.message;

  if (!response.ok) {
    throw new Error(
      apiMessage
        ? `AniList API error (${response.status}): ${apiMessage}`
        : `AniList API error: ${response.status} ${response.statusText}`,
    );
  }

  if (apiMessage) {
    throw new Error(`AniList GraphQL error: ${apiMessage}`);
  }

  if (!json?.data) {
    throw new Error("Unexpected response from AniList API");
  }

  return json.data;
}

function fuzzyDateToInt(date: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}): number {
  return (date.year ?? 0) * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0);
}

/**
 * Search AniList media using a direct GraphQL call, bypassing the anilist-node
 * library's filterBuilder which silently drops season/seasonYear filters when
 * combined with sort: [SEARCH_MATCH] and no search term.
 */
export async function searchMediaDirect(
  type: "ANIME" | "MANGA",
  term: string | undefined,
  filter: Record<string, unknown> | undefined,
  page: number,
  perPage: number,
  token?: string,
): Promise<unknown> {
  const variables: Record<string, unknown> = { page, perPage, type };
  if (term) variables.search = term;

  const activeFilterKeys: string[] = [];

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      if (key === "type") continue; // enforced by the tool, not the filter

      if (
        (key === "startDate" || key === "endDate") &&
        typeof value === "object" &&
        value !== null &&
        ("year" in value || "month" in value || "day" in value)
      ) {
        variables[key] = fuzzyDateToInt(
          value as { year?: number | null; month?: number | null; day?: number | null },
        );
      } else {
        variables[key] = value;
      }
      if (key !== "search") activeFilterKeys.push(key);
    }
  }

  const varDecls = [
    "$page: Int!",
    "$perPage: Int!",
    "$type: MediaType",
    ...(variables.search !== undefined ? ["$search: String"] : []),
    ...activeFilterKeys
      .filter((k) => MEDIA_FILTER_GQL_TYPES[k])
      .map((k) => `\$${k}: ${MEDIA_FILTER_GQL_TYPES[k]}`),
  ].join(", ");

  const mediaArgs = [
    "type: $type",
    ...(variables.search !== undefined ? ["search: $search"] : []),
    ...activeFilterKeys
      .filter((k) => MEDIA_FILTER_GQL_TYPES[k])
      .map((k) => `${k}: \$${k}`),
  ].join(", ");

  const query = `
    query (${varDecls}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(${mediaArgs}) {
          id idMal
          title { romaji english native userPreferred }
          format description
          startDate { year month day }
          endDate { year month day }
          season seasonYear episodes duration chapters volumes
          countryOfOrigin hashtag updatedAt
          # status and source are versioned enums: unversioned, AniList
          # answers with the legacy v1 set, which reports every HIATUS title
          # as RELEASING and collapses WEB_NOVEL/COMIC/GAME/LIVE_ACTION/
          # MULTIMEDIA_PROJECT/PICTURE_BOOK into OTHER. These are the highest
          # versions AniList honours; higher numbers silently fall back to v1.
          status(version: 2)
          source(version: 3)
          coverImage { large medium color }
          bannerImage genres synonyms
          averageScore meanScore popularity favourites isAdult
          nextAiringEpisode { airingAt timeUntilAiring episode }
          tags { id name isMediaSpoiler }
          studios { nodes { id name isAnimationStudio } }
          externalLinks { url }
          streamingEpisodes { title url }
          rankings { rank type context year season }
          siteUrl
        }
      }
    }
  `;

  // Only authenticate when a filter actually needs a logged-in user. AniList
  // rejects the entire request with 400 "Invalid token" whenever the header is
  // present and stale, so sending it unconditionally lets one expired token
  // take out public search as well.
  const trimmedToken = token?.trim() || undefined;
  const needsAuth = AUTH_REQUIRING_MEDIA_FILTERS.some(
    (k) => filter?.[k] !== undefined && filter?.[k] !== null,
  );

  const data = await postGraphQL(query, variables, needsAuth ? trimmedToken : undefined);

  if (!data.Page) {
    throw new Error("Unexpected response from AniList API");
  }

  return data.Page;
}

// GraphQL types for each field SaveMediaListEntry accepts, confirmed via
// live introspection against https://graphql.anilist.co (2026-07-09).
// Deliberately excludes id/mediaId: callers supply those as a separate
// top-level id argument (media id for add, list-entry id for update) that
// gets merged in by saveMediaListEntryDirect's caller, not through options.
const SAVE_ENTRY_GQL_TYPES: Record<string, string> = {
  status: "MediaListStatus",
  score: "Float",
  scoreRaw: "Int",
  progress: "Int",
  progressVolumes: "Int",
  repeat: "Int",
  priority: "Int",
  private: "Boolean",
  notes: "String",
  hiddenFromStatusLists: "Boolean",
  customLists: "[String]",
  advancedScores: "[Float]",
  startedAt: "FuzzyDateInput",
  completedAt: "FuzzyDateInput",
};

/**
 * Create or update a list entry using a direct GraphQL call with real
 * GraphQL variables, bypassing the anilist-node library's headerBuilder.js,
 * which hand-concatenates mutation arguments into a query string: it throws
 * on any array/object value other than startedAt/completedAt (so
 * customLists/advancedScores always crash), and never quotes string values
 * (so any non-empty `notes` produces invalid GraphQL syntax).
 *
 * @param id - media id (add) or list-entry id (update); see callers.
 * @param idField - which GraphQL argument `id` maps to for this call.
 * @param options - value fields to save; must not contain id/mediaId.
 * @param token - AniList API token (required, this always requires login).
 */
export async function saveMediaListEntryDirect(
  id: number,
  idField: "id" | "mediaId",
  options: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const variables: Record<string, unknown> = { [idField]: id };
  const activeKeys: string[] = [idField];

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (!SAVE_ENTRY_GQL_TYPES[key]) continue;

    // JSON.stringify (in postGraphQL's fetch body) serializes objects/arrays/
    // strings correctly on its own — unlike headerBuilder.js, there's no
    // special-casing needed here for startedAt/completedAt.
    variables[key] = value;
    activeKeys.push(key);
  }

  const varDecls = [
    `\$${idField}: Int`,
    ...activeKeys
      .filter((k) => k !== idField)
      .map((k) => `\$${k}: ${SAVE_ENTRY_GQL_TYPES[k]}`),
  ].join(", ");

  const mutationArgs = activeKeys.map((k) => `${k}: \$${k}`).join(", ");

  const query = `
    mutation (${varDecls}) {
      SaveMediaListEntry(${mutationArgs}) {
        id mediaId status score progress progressVolumes repeat priority
        private notes hiddenFromStatusLists customLists advancedScores
        startedAt { year month day } completedAt { year month day }
        updatedAt createdAt
      }
    }
  `;

  const data = await postGraphQL(query, variables, token.trim() || undefined);

  if (!data.SaveMediaListEntry) {
    throw new Error("Unexpected response from AniList API");
  }

  return data.SaveMediaListEntry;
}

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
