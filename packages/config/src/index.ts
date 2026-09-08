// Side effect: loads the repo-root .env into process.env before anything
// else in this package (or any consumer that imports it) runs. Must stay
// the first import in this file.
import "./load-env.js";

export { getEnv, resetEnvCache } from "./env.js";
export type { Env } from "./env.js";
export { findMonorepoRoot } from "./load-env.js";
