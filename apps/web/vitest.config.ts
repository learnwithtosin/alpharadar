import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No feature pages/components exist yet in this phase — nothing to test.
    passWithNoTests: true,
  },
});
