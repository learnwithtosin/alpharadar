import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findMonorepoRoot } from "./load-env.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("findMonorepoRoot", () => {
  it("finds the real monorepo root by walking up from this file's own directory", () => {
    // The actual repo really does have pnpm-workspace.yaml above this
    // file — confirms the walk-up logic against real, not synthetic, disk
    // state.
    expect(findMonorepoRoot(here)).toBeTruthy();
  });

  it("returns undefined, not a throw, when no pnpm-workspace.yaml exists above startDir", () => {
    // A serverless deployment's traced/bundled runtime filesystem is
    // exactly this shape — a directory tree with no monorepo marker
    // anywhere above it. /tmp is guaranteed not to contain one.
    const isolated = mkdtempSync(join(tmpdir(), "alpharadar-no-root-"));
    try {
      expect(findMonorepoRoot(isolated)).toBeUndefined();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("finds a synthetic marker placed at a known depth, proving the walk-up itself is correct", () => {
    const root = mkdtempSync(join(tmpdir(), "alpharadar-root-"));
    try {
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      const nested = join(root, "apps", "web", "src");
      mkdirSync(nested, { recursive: true });

      expect(findMonorepoRoot(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
