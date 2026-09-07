import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No pipeline logic exists yet in this phase — nothing to test.
    passWithNoTests: true,
  },
});
