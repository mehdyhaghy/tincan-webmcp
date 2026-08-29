import { describe, expect, it } from "vitest";
import { sanitizeString, sanitizeValueWithMetadata } from "./sanitize";

describe("shared sanitizer", () => {
  it("redacts UUIDs in arbitrary strings", () => {
    expect(sanitizeString("request 550e8400-e29b-41d4-a716-446655440000 failed"))
      .toBe("request [REDACTED_UUID] failed");
  });

  it("redacts only payment-card candidates with a valid Luhn checksum", () => {
    expect(sanitizeString("card 4242 4242 4242 4242"))
      .toBe("card [REDACTED_PAYMENT_CARD]");
    expect(sanitizeString("order 1234567890123456789 at 1700000000000"))
      .toBe("order 1234567890123456789 at 1700000000000");
  });

  it("honors configured evidence limits and reports structural truncation", () => {
    const preserved = sanitizeValueWithMetadata(Array.from({ length: 500 }, (_, index) => index), {
      maxArrayItems: 500,
    });
    expect(preserved.truncated).toBe(false);
    expect(preserved.value).toHaveLength(500);

    const truncated = sanitizeValueWithMetadata(Array.from({ length: 501 }, (_, index) => index), {
      maxArrayItems: 500,
    });
    expect(truncated.truncated).toBe(true);
    expect(truncated.value).toHaveLength(500);
  });
});
