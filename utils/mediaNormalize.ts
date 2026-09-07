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
