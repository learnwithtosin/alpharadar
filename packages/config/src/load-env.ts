import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

/**
 * Walks up from `startDir` looking for pnpm-workspace.yaml, which marks
 * the monorepo root — used only to locate a local .env file, a
 * development convenience. Returns `undefined`, not a throw, when no
 * marker is found: a serverless deployment's traced/bundled runtime
 * filesystem (Vercel) contains only the files actually imported, not the
 * whole repo, so pnpm-workspace.yaml genuinely isn't there — that's the
 * expected shape of a deployment, not an error condition. Whether a
 * required env var is actually present is a completely separate
 * question, answered by env.ts's own validation (by variable name), not
 * by whether a monorepo happens to exist on disk.
 */
export function findMonorepoRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * True on the hosting platforms this project actually deploys to —
 * Vercel (apps/web) and GitHub Actions (apps/pipeline's cron, see
 * docs/decisions/0002) both inject real env vars directly into
 * process.env, with no .env file or monorepo checkout on the runtime
 * filesystem. Checked explicitly, before ever touching the filesystem,
 * rather than relying solely on findMonorepoRoot's "not found" fallback —
 * that fallback still covers any *other* environment (a different host,
 * a Docker image with no .env baked in) that doesn't set one of these.
 */
function isDeployedEnvironment(): boolean {
  return Boolean(process.env.VERCEL ?? process.env.GITHUB_ACTIONS ?? process.env.CI);
}

const here = dirname(fileURLToPath(import.meta.url));

// dotenv never overwrites a variable already present in process.env, so
// loading is always safe where a .env file exists. But finding one to
// load is a local-development convenience, not a runtime requirement —
// skip the search entirely in a known-deployed environment, and treat
// "no monorepo root found" the same way everywhere else: a harmless
// no-op, never a thrown error. The only place a genuinely missing
// variable becomes an error is env.ts's own validation, which names the
// variable, not the filesystem.
if (!isDeployedEnvironment()) {
  const root = findMonorepoRoot(here);
  if (root) {
    loadDotenv({ path: join(root, ".env") });
  }
}
