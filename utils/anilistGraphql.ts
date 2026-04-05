const ANILIST_API = "https://graphql.anilist.co";

// GraphQL types for each field in MediaFilterTypesSchema
const MEDIA_FILTER_GQL_TYPES: Record<string, string> = {
  id: "Int", idMal: "Int",
  startDate: "FuzzyDateInt", endDate: "FuzzyDateInt",
  season: "MediaSeason", seasonYear: "Int",
  format: "MediaFormat", status: "MediaStatus",
  episodes: "Int", duration: "Int", chapters: "Int", volumes: "Int",
  isAdult: "Boolean", genre: "String", tag: "String",
  minimumTagRank: "Int", tagCategory: "String", onList: "Boolean",
  licensedBy: "String", averageScore: "Int", popularity: "Int",
  source: "MediaSource", countryOfOrigin: "CountryCode", sort: "[MediaSort]",
  search: "String",
  id_not: "Int", id_in: "[Int]", id_not_in: "[Int]",
  idMal_not: "Int", idMal_in: "[Int]", idMal_not_in: "[Int]",
  startDate_greater: "FuzzyDateInt", startDate_lesser: "FuzzyDateInt", startDate_like: "String",
  endDate_greater: "FuzzyDateInt", endDate_lesser: "FuzzyDateInt", endDate_like: "String",
  format_in: "[MediaFormat]", format_not: "MediaFormat", format_not_in: "[MediaFormat]",
  status_in: "[MediaStatus]", status_not: "MediaStatus", status_not_in: "[MediaStatus]",
  episodes_greater: "Int", episodes_lesser: "Int",
  duration_greater: "Int", duration_lesser: "Int",
  chapters_greater: "Int", chapters_lesser: "Int",
  volumes_greater: "Int", volumes_lesser: "Int",
  genre_in: "[String]", genre_not_in: "[String]",
  tag_in: "[String]", tag_not_in: "[String]",
  tagCategory_in: "[String]", tagCategory_not_in: "[String]",
  licensedBy_in: "[String]",
  averageScore_not: "Int", averageScore_greater: "Int", averageScore_lesser: "Int",
  popularity_not: "Int", popularity_greater: "Int", popularity_lesser: "Int",
  source_in: "[MediaSource]",
};

function fuzzyDateToInt(date: { year: number | null; month: number | null; day: number | null }): number {
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
        "year" in value
      ) {
        variables[key] = fuzzyDateToInt(value as { year: number | null; month: number | null; day: number | null });
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
          format status description
          startDate { year month day }
          endDate { year month day }
          season seasonYear episodes duration chapters volumes
          countryOfOrigin source hashtag updatedAt
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

  const response = await fetch(ANILIST_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`AniList API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data?: { Page: unknown };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`AniList GraphQL error: ${json.errors[0].message}`);
  }

  if (!json.data?.Page) {
    throw new Error("Unexpected response from AniList API");
  }

  return json.data.Page;
}
