import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../utils/concurrency.js";

describe("mapWithConcurrency", () => {
  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // still parallel, not serialised
  });

  it("preserves input order regardless of completion order", async () => {
    const result = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20, 0]);
  });

  it("returns an empty array for empty input", async () => {
    expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([]);
  });

  it("rejects if any task rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
