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
