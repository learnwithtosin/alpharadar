// Side effect: loads the repo-root .env before Prisma CLI (generate,
// migrate, studio, validate...) reads DATABASE_URL / DIRECT_URL out of
// schema.prisma. Prisma's own built-in .env discovery only looks next to
// schema.prisma or in the CLI's cwd — neither is the monorepo root — so
// without this, every `prisma` command needs env vars passed by hand.
import "@alpharadar/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
});
