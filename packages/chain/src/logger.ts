/**
 * A minimal, injectable logging seam for this package — packages/chain has
 * no dependency on apps/pipeline's own logger.ts, but the shape matches it
 * exactly (JSON lines, `info`/`warn`, an `event` name plus arbitrary
 * fields) so a caller can pass its real logger straight through and get
 * one consistent log stream, or omit it and fall back to this same-shaped
 * default (used by tests, and any future consumer that doesn't care).
 */
export interface AdapterLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function emit(level: "info" | "warn", event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify(
    { timestamp: new Date().toISOString(), level, event, ...fields },
    replacer,
  );
  if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const defaultAdapterLogger: AdapterLogger = {
  info(event, fields = {}) {
    emit("info", event, fields);
  },
  warn(event, fields = {}) {
    emit("warn", event, fields);
  },
};
