import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      // The hand-written modules under test. schemas.generated.ts is excluded
      // deliberately: it is introspection output, and `sync-schema` regenerating
      // it is the thing that keeps it honest, not a unit test.
      include: [
        "utils/anilistGraphql.ts",
        "utils/mediaSelection.ts",
        "utils/mediaNormalize.ts",
      ],
      reporter: ["text", "lcov"],
    },
  },
});
