import { describe, expect, it } from "vitest";
import { getEnv } from "./env.js";

describe("getEnv", () => {
  it("applies the 09 §9 defaults against an empty development env", () => {
    const env = getEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);

    expect(env.RUN_MODE).toBe("poll");
    expect(env.ROBINHOOD_CHAIN_ID).toBe(4663);
    expect(env.ROBINHOOD_RPC_URL).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(env.ALERT_MIN_SCORE).toBe(60);
    expect(env.AI_MIN_SCORE_TO_ANALYZE).toBe(70);
    expect(env.AI_ENABLED).toBe(false);
  });

  it("coerces AI_ENABLED=true correctly, avoiding the truthy-string coercion trap", () => {
    expect(getEnv({ AI_ENABLED: "true" } as NodeJS.ProcessEnv).AI_ENABLED).toBe(true);
    expect(getEnv({ AI_ENABLED: "false" } as NodeJS.ProcessEnv).AI_ENABLED).toBe(false);
  });

  it("rejects an invalid RUN_MODE", () => {
    expect(() => getEnv({ RUN_MODE: "websocket" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("requires DATABASE_URL, DIRECT_URL, AUTH_SECRET and TELEGRAM_BOT_TOKEN in production", () => {
    expect(() => getEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /Missing required production environment variables/,
    );
  });

  it("passes in production once the required variables are present", () => {
    const env = getEnv({
      NODE_ENV: "production",
      AUTH_SECRET: "secret",
      DATABASE_URL: "postgresql://user:pass@host:6543/db?pgbouncer=true",
      DIRECT_URL: "postgresql://user:pass@host:5432/db",
      TELEGRAM_BOT_TOKEN: "123:abc",
    } as NodeJS.ProcessEnv);

    expect(env.NODE_ENV).toBe("production");
  });

  it("treats an env var present as an empty string the same as unset, for optional fields", () => {
    // .env.example ships every key blank (e.g. `AUTH_SECRET=`), which
    // dotenv loads as "", not as an absent key. That must not fail
    // validation for an optional field in development.
    const env = getEnv({
      NODE_ENV: "development",
      AUTH_SECRET: "",
      DATABASE_URL: "",
      DIRECT_URL: "",
      TELEGRAM_BOT_TOKEN: "",
      AI_API_KEY: "",
      ROBINHOOD_WS_URL: "",
    } as NodeJS.ProcessEnv);

    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_URL).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.ROBINHOOD_WS_URL).toBeUndefined();
  });

  it("still requires the production variables when they're present but empty", () => {
    expect(() =>
      getEnv({
        NODE_ENV: "production",
        AUTH_SECRET: "",
        DATABASE_URL: "",
        DIRECT_URL: "",
        TELEGRAM_BOT_TOKEN: "",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Missing required production environment variables/);
  });
});
