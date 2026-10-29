import "server-only";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Keys whose values must never reach logs.
const REDACT = /pass(word)?|secret|token|cookie|authorization|session|backup|otp|code$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  return out;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) ?? "info";
  return order[lvl] ?? order.info;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields ?? {}) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Structured JSON logger with key-based redaction of sensitive fields. */
export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

export { redact as _redactForTest };
