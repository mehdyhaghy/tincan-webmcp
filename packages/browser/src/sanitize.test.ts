import { describe, expect, it } from "vitest";
import { sanitizePath, sanitizeString, sanitizeValue } from "./sanitize";

describe("privacy sanitizer", () => {
  it("removes origins, query strings, fragments, and path identifiers", () => {
    expect(sanitizePath("https://example.com/accounts/550e8400-e29b-41d4-a716-446655440000/orders/123456789?token=secret#card"))
      .toBe("/accounts/:id/orders/:id");
  });

  it("redacts recursively sensitive keys", () => {
    expect(sanitizeValue({ profile: { password: "hunter2", api_key: "abc", safe: "ok" } })).toEqual({
      profile: { password: "[REDACTED]", api_key: "[REDACTED]", safe: "ok" },
    });
  });

  it("redacts tokens, payment cards, and private keys from strings", () => {
    const input = "Bearer abc.def.ghi 4242 4242 4242 4242 -----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----";
    const output = sanitizeString(input);
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("4242 4242");
    expect(output).not.toContain("secret");
  });
});
