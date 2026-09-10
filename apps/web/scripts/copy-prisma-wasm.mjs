// Prisma's generated "client" engineType runtime (packages/database's
// schema.prisma — engineType = "client", @prisma/adapter-pg) loads its
// query-compiler Wasm module from a path it computes relative to its own
// bundled location at runtime, not from wherever schema.prisma's `output`
// actually points. Confirmed live, the hard way: after bundling apps/web
// with Next.js, the exact thrown error was
//   ENOENT: ... open '<app root>/generated/client/query_compiler_bg.wasm'
// — i.e. it falls back to an app-root-relative "generated/client"
// convention (the same convention Prisma's own current docs recommend for
// `output`) regardless of this monorepo's actual shared-package location
// (packages/database/generated/client). See
// docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
//
// This copies the two files that path actually needs into apps/web's own
// project root, so the app-relative guess resolves to a real file both in
// local dev and inside the deployed bundle (once traced there — see
// next.config.ts). Deliberately not a second Prisma generator block for
// the same output: that would regenerate an entire second unused client
// (full type declarations, index.js, etc.) just to get two small runtime
// files copied — this copies exactly what's needed, nothing else, and
// runs after `prisma generate` so it always reflects the current schema.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = join(__dirname, "../../../packages/database/generated/client");
const destination = join(__dirname, "../generated/client");

mkdirSync(destination, { recursive: true });
for (const file of ["query_compiler_bg.js", "query_compiler_bg.wasm"]) {
  copyFileSync(join(source, file), join(destination, file));
}

console.info(`Copied Prisma query-compiler runtime files to ${destination}`);
