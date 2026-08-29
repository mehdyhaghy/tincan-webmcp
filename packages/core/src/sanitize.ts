const SENSITIVE_KEY = /password|passcode|secret|token|authorization|cookie|api[_-]?key|jwt|private[_-]?key/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_NUMBER = /(?<=\/)\d{7,}(?=\/|$)/g;

export interface SanitizeOptions {
  maxArrayItems?: number;
  maxDepth?: number;
  maxObjectEntries?: number;
}

export interface SanitizeResult {
  value: unknown;
  truncated: boolean;
}

export function sanitizeString(value: string, maxLength = 2_000): string {
  return value
    .replace(PEM, "[REDACTED_PRIVATE_KEY]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(CARD, "[REDACTED_PAYMENT_CARD]")
    .replace(UUID, "[REDACTED_UUID]")
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

export function sanitizeValueWithMetadata(value: unknown, options: SanitizeOptions = {}): SanitizeResult {
  const limits = {
    maxArrayItems: options.maxArrayItems ?? 50,
    maxDepth: options.maxDepth ?? 12,
    maxObjectEntries: options.maxObjectEntries ?? 50,
  };
  let truncated = false;

  const visit = (entry: unknown, depth: number): unknown => {
    if (depth > limits.maxDepth) {
      truncated = true;
      return "[TRUNCATED]";
    }
    if (typeof entry === "string") return sanitizeString(entry);
    if (typeof entry === "number" || typeof entry === "boolean" || entry === null) return entry;
    if (Array.isArray(entry)) {
      if (entry.length > limits.maxArrayItems) truncated = true;
      return entry.slice(0, limits.maxArrayItems).map((item) => visit(item, depth + 1));
    }
    if (typeof entry === "object") {
      const entries = Object.entries(entry as Record<string, unknown>);
      if (entries.length > limits.maxObjectEntries) truncated = true;
      return Object.fromEntries(
        entries
          .slice(0, limits.maxObjectEntries)
          .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(item, depth + 1)]),
      );
    }
    return String(entry).slice(0, 500);
  };

  return { value: visit(value, 0), truncated };
}

export function sanitizeValue(value: unknown, options?: SanitizeOptions): unknown {
  return sanitizeValueWithMetadata(value, options).value;
}
