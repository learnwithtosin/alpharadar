import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Pure lib/ helpers (formatting, domain-color mapping) are unit
    // tested; the Server Component pages themselves are verified live
    // against the dev server, not here — an async page doing a real
    // Prisma query isn't practically unit-testable the way a pure
    // function is. Left true so a future page/component-only change
    // doesn't fail CI for having nothing new to test.
    passWithNoTests: true,
  },
});
