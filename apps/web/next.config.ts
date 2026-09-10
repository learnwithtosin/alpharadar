import type { NextConfig } from "next";

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
  // (query_compiler_bg.wasm). That still isn't reachable through a real
  // `import`/`require` Next's tracer can follow: it's loaded by a path
  // Prisma's runtime computes relative to its own bundled location,
  // confirmed live to resolve to an app-root-relative
  // "generated/client/query_compiler_bg.wasm" regardless of where
  // schema.prisma's `output` actually points (a real ENOENT at exactly
  // that path, thrown from the bundled server chunk, is what confirmed
  // this — not documentation). scripts/copy-prisma-wasm.mjs (run from
  // `predev`/`prebuild`) copies the real generated file to that app-root
  // path so it exists at all; this tells Next's build to actually ship it
  // from there into the deployed function. See
  // docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
  outputFileTracingIncludes: {
    "/**": ["./generated/client/*"],
  },
};

export default nextConfig;
