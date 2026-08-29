import { describe, expect, it, vi } from "vitest";
import { installConsoleInstrumentation } from "./console-instrumentation";

const fakeConsole = (): Pick<Console, "warn" | "error"> => ({
  warn: vi.fn() as unknown as typeof console.warn,
  error: vi.fn() as unknown as typeof console.error,
});

describe("console instrumentation", () => {
  it("preserves console behavior when diagnostic capture throws", () => {
    const target = fakeConsole();
    const originalWarn = target.warn;
    installConsoleInstrumentation(target, () => {
      throw new Error("collector failed");
    });

    expect(() => target.warn("host message", 42)).not.toThrow();
    expect(originalWarn).toHaveBeenCalledWith("host message", 42);
  });

  it("restores only wrappers that it still owns", () => {
    const target = fakeConsole();
    const originalWarn = target.warn;
    const originalError = target.error;
    const instrumentation = installConsoleInstrumentation(target, vi.fn());
    const laterErrorPatch = vi.fn() as unknown as typeof console.error;
    target.error = laterErrorPatch;

    instrumentation.stop();

    expect(target.warn).toBe(originalWarn);
    expect(target.error).toBe(laterErrorPatch);
    expect(target.error).not.toBe(originalError);
  });
});
