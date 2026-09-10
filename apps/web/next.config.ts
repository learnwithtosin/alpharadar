import type { NextConfig } from "next";
import { copyPrismaWasmRuntime } from "./scripts/copy-prisma-wasm.mjs";

// Runs at config-load time — guaranteed for every `next build`/`next
// dev`/`next start` invocation, regardless of how the invoking platform
// actually runs the build (unlike the `predev`/`prebuild` npm scripts,
// whose execution depends on the platform choosing to run the build via
// a package-manager script the way `pnpm run build` does, not e.g. a
// literal `next build` override). See
// apps/web/scripts/copy-prisma-wasm.mjs and
// docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
copyPrismaWasmRuntime();

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript with no build step; Next needs
  // to know to transpile them rather than treat them as pre-built.
  transpilePackages: ["@alpharadar/types", "@alpharadar/config", "@alpharadar/database"],
  // Confirmed live: transpilePackages alone isn't enough. Every workspace
  // package's own internal imports use explicit ".js" extensions pointing
  // at ".ts" source (this monorepo's established NodeNext-style ESM
  // convention — e.g. packages/config/src/index.ts's `import
  // "./load-env.js"`), which tsx/tsc resolve fine but webpack's resolver
  // does not by default — it treats ".js" as a literal, separate
  // extension and fails with "Module not found" the first time apps/web
  // actually imports one of these packages (packages/database, here).
  // extensionAlias tells webpack to also try ".ts"/".tsx" for a ".js"
  // specifier before falling back to a real ".js" file.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // packages/database's schema.prisma now uses @prisma/adapter-pg with
  // `engineType = "client"` — no native query-engine binary exists
  // anymore, only a much smaller Wasm query compiler
  // (query_compiler_bg.wasm). That's still not reachable through a real
  // `import`/`require` Next's tracer can follow: read directly out of the
  // bundled server chunk (not assumed), Prisma's own runtime does
  // `fs.readFileSync(path.join(config.dirname, "query_compiler_bg.wasm"))`
  // where `config.dirname` resolves to `process.cwd() + "/generated/
  // client"` once bundled — confirmed against two independent real
  // ENOENT errors naming exactly that app-root-relative path (a local
  // standalone run, and Vercel's own deployment logs), not documentation.
  // `copyPrismaWasmRuntime()` above copies the real generated files to
  // that path so they exist at all; naming the exact files here (not a
  // wildcard) tells Next's build to actually ship them from there into
  // the deployed function — a wildcard glob was tried first and, per the
  // investigation this decision documents, did not reliably survive
  // Vercel's real packaging the way it did in local verification, so this
  // is deliberately as explicit as the API allows. See
  // docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
  outputFileTracingIncludes: {
    "/**": [
      "./generated/client/query_compiler_bg.js",
      "./generated/client/query_compiler_bg.wasm",
      "./generated/client/schema.prisma",
    ],
  },
};

export default nextConfig;
