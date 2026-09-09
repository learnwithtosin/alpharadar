/**
 * This process runs unattended on a schedule (GitHub Actions per 09 §4) —
 * the log is the only visibility into whether a run did anything. One JSON
 * object per line: greppable/jq-able in a CI log, and every field survives
 * (including bigint block numbers, which JSON.stringify otherwise throws
 * on) via the replacer below.
 */
type LogFields = Record<string, unknown>;

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields): void {
  const line = JSON.stringify(
    { timestamp: new Date().toISOString(), level, event, ...fields },
    replacer,
  );
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const log = {
  info(event: string, fields: LogFields = {}): void {
    emit("info", event, fields);
  },
  /** Notice, not a failure — e.g. packages/chain's discovery-scan instrumentation (AdapterLogger) routes here. */
  warn(event: string, fields: LogFields = {}): void {
    emit("warn", event, fields);
  },
  /** Always includes the error's name, not just its message — "loud, named" per instruction. */
  error(event: string, error: unknown, fields: LogFields = {}): void {
    emit("error", event, {
      ...fields,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  },
};
