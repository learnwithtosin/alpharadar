import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript with no build step; Next needs
  // to know to transpile them rather than treat them as pre-built.
  transpilePackages: ["@alpharadar/types", "@alpharadar/config", "@alpharadar/database"],
};

export default nextConfig;
