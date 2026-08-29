export type CapturedConsoleLevel = "warn" | "error";

export interface ConsoleInstrumentation {
  stop(): void;
}

export function installConsoleInstrumentation(
  target: Pick<Console, "warn" | "error">,
  capture: (level: CapturedConsoleLevel, args: unknown[]) => void,
): ConsoleInstrumentation {
  const originalWarn = target.warn;
  const originalError = target.error;

  const wrappedWarn: typeof console.warn = function (this: Console, ...args: unknown[]): void {
    try {
      capture("warn", args);
    } catch {
      // Diagnostics must never change host console behavior.
    }
    Reflect.apply(originalWarn, this, args);
  };
  const wrappedError: typeof console.error = function (this: Console, ...args: unknown[]): void {
    try {
      capture("error", args);
    } catch {
      // Diagnostics must never change host console behavior.
    }
    Reflect.apply(originalError, this, args);
  };

  target.warn = wrappedWarn;
  target.error = wrappedError;

  return {
    stop(): void {
      if (target.warn === wrappedWarn) target.warn = originalWarn;
      if (target.error === wrappedError) target.error = originalError;
    },
  };
}
