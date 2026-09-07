import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // This package is a placeholder for this phase — no logic yet, so no
    // test files. See src/index.ts.
    passWithNoTests: true,
  },
});
