// Prisma's generated "client" engineType runtime (packages/database's
// schema.prisma — engineType = "client", @prisma/adapter-pg) loads its
// query-compiler Wasm module via a path it computes AT RUNTIME, not a
// build-time constant and not wherever schema.prisma's `output` actually
// points. Read straight out of the real bundled server chunk (not
// assumed from source or docs) — the exact compiled logic is:
//
//   config.dirname = __dirname;
//   if (!fs.existsSync(path.join(__dirname, "schema.prisma"))) {
//     // bundled — __dirname no longer sits next to schema.prisma
//     const candidates = ["generated/client", "client"];
//     const found = candidates.find((c) =>
//       fs.existsSync(path.join(process.cwd(), c, "schema.prisma")),
//     ) ?? candidates[0];
//     config.dirname = path.join(process.cwd(), found);
//   }
//   // later: fs.readFileSync(path.join(config.dirname, "query_compiler_bg.wasm"))
//
// So once webpack bundles this code, `config.dirname` resolves to
// `process.cwd() + "/generated/client"` — an app-root-relative path
// confirmed against two independent real ENOENT errors (a local
// standalone run, and Vercel's real deployment), not assumed. This
// copies `query_compiler_bg.{js,wasm}` and `schema.prisma` (Prisma's own
// candidate-selection check above reads that file too, even though the
// "generated/client" default it falls back to regardless makes this
// belt-and-suspenders here) to that real, app-root-relative location. See
// docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
//
// Deliberately not a second Prisma generator block pointed at the same
// output: that would regenerate an entire second unused client (full
// type declarations, index.js, etc.) just to relocate three small files.
//
// Called from next.config.ts at module-load time — guaranteed to run
// whenever `next build`/`next dev`/`next start` runs, regardless of
// whether the platform invoking the build actually triggers npm/pnpm's
// `prebuild` lifecycle hook (unverifiable from here for Vercel's real
// build pipeline; this removes the dependency on that assumption
// entirely). Also wired into `predev`/`prebuild` for local-dev
// convenience — copyFileSync is idempotent, so running it twice is
// harmless.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function copyPrismaWasmRuntime() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = join(__dirname, "../../../packages/database/generated/client");
  const destination = join(__dirname, "../generated/client");

  if (!existsSync(source)) {
    throw new Error(
      `Prisma generated client not found at ${source} — run \`pnpm --filter ` +
        `@alpharadar/database db:generate\` first.`,
    );
  }

  mkdirSync(destination, { recursive: true });
  for (const file of ["query_compiler_bg.js", "query_compiler_bg.wasm", "schema.prisma"]) {
    copyFileSync(join(source, file), join(destination, file));
  }

  console.info(`Copied Prisma query-compiler runtime files to ${destination}`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  copyPrismaWasmRuntime();
}
