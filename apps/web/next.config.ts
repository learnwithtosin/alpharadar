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
  // Belt-and-suspenders for the same problem extensionAlias above works
  // around, one layer deeper: Next's output file tracing decides what a
  // deployed serverless function actually ships by walking real
  // `import`/`require` statements. Prisma's native query engine
  // (packages/database/generated/client/libquery_engine-*.so.node — see
  // schema.prisma's generator comment) is never `require()`d; Prisma's own
  // runtime finds it via a computed filesystem path at query time. That
  // makes it invisible to the trace regardless of where it lives, so the
  // "Prisma Client could not locate the Query Engine" error persisted even
  // after moving the generator's `output` out of pnpm's hoisted store into
  // this real, traceable path — the path became inspectable, but nothing
  // was actually asking to inspect it. This is Next.js's own documented
  // fix, and Prisma's own linked fix for this exact error on Next.js
  // (https://pris.ly/d/engine-not-found-nextjs): explicitly tell the
  // tracer to include it. `/**` (every route) because Prisma is reachable
  // from every page via AppHeader in the root layout, not just the pages
  // that query it directly.
  outputFileTracingIncludes: {
    "/**": ["../../packages/database/generated/client/*.so.node"],
  },
};

export default nextConfig;
