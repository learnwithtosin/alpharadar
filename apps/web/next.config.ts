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
};

export default nextConfig;
