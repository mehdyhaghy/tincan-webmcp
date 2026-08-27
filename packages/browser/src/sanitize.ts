const SENSITIVE_KEY = /password|passcode|secret|token|authorization|cookie|api[_-]?key|jwt|private[_-]?key/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_NUMBER = /(?<=\/)\d{7,}(?=\/|$)/g;

export function sanitizeString(value: string, maxLength = 2_000): string {
  return value
    .replace(PEM, "[REDACTED_PRIVATE_KEY]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(CARD, "[REDACTED_PAYMENT_CARD]")
    .slice(0, maxLength);
}

export function sanitizePath(input: string): string {
  try {
    const url = new URL(input, "https://tincan.invalid");
    return url.pathname.replace(UUID, ":id").replace(LONG_NUMBER, ":id");
  } catch {
    return sanitizeString(input.split(/[?#]/, 1)[0] ?? "", 500);
  }
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeValue(entry, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}
