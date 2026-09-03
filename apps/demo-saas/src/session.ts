const STORAGE_KEY = "tincan:demo:session";
export const SESSION_HEADER = "x-tincan-session";

const storedSessionId = (): string | undefined => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const rememberSessionId = (id: string | null): void => {
  if (!id) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the cookie alone still carries the session.
  }
};

/**
 * Same-origin fetch that carries the anonymous demo session. The API sets an HttpOnly
 * cookie, which the browser replays on its own; the header is a fallback that lets the
 * page resume the same server-side state when cookies are unavailable, using an
 * identifier the API echoes back on every response.
 */
export async function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const id = storedSessionId();
  if (id && !headers.has(SESSION_HEADER)) headers.set(SESSION_HEADER, id);
  const response = await fetch(input, { credentials: "same-origin", ...init, headers });
  rememberSessionId(response.headers.get(SESSION_HEADER));
  return response;
}
