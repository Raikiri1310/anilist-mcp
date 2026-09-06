/**
 * Map over items with a ceiling on how many run at once, preserving input
 * order. Used to keep multi-id tool calls from hammering AniList: the API is
 * currently degraded to 30 requests/minute (90 normally) and runs a separate
 * burst limiter on top, and exceeding either costs a full minute's lockout
 * for the whole server, not just the offending call.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}
