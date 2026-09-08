import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

/**
 * Walks up from `startDir` until it finds pnpm-workspace.yaml, which marks
 * the monorepo root. pnpm --filter changes cwd to the target package's own
 * directory, so a fixed relative path (e.g. "../../.env") would break for
 * any package at a different depth from root — walking up from this file's
 * own location works regardless of depth or how the process was invoked.
 */
export function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the monorepo root (no pnpm-workspace.yaml found above ${startDir}).`,
      );
    }
    dir = parent;
  }
  return dir;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = findMonorepoRoot(here);

// dotenv never overwrites a variable already present in process.env, so
// this is safe to import from every app/package and safe in environments
// (CI, hosting platforms) where real secrets are injected directly rather
// than via a .env file — there, this is a harmless no-op.
loadDotenv({ path: join(root, ".env") });
