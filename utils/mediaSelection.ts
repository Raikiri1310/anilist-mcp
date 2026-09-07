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
