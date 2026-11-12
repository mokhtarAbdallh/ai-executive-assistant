/**
 * HTTP layer for the API (ADR-022).
 *
 * - Attaches the short-lived access token (15 min) as a Bearer header.
 * - On 401 it refreshes ONCE via the httpOnly refresh cookie and retries; if the
 *   refresh fails the session is cleared and `onSessionExpired` listeners fire
 *   (the app then shows the login screen).
 * - Every non-2xx response throws an ApiError carrying the server's message.
 *   Nothing here ever invents a successful response.
 */

const TOKEN_KEY = "dawwen_access_token";

/** Offline demo mode: only when explicitly built with VITE_DEMO_MODE=true. */
export const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return readToken();
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts for this page only.
  }
}

type ExpiredListener = () => void;
const expiredListeners = new Set<ExpiredListener>();

/** Subscribes to "session expired" (refresh failed). Returns an unsubscribe function. */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

const NO_REFRESH_URLS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/logout",
]);

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent 401s
 * share one refresh request.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken?: string };
        if (!data.accessToken) return false;
        setAccessToken(data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string" && body.message) message = body.message;
    else if (typeof body.error === "string" && body.error) message = body.error;
    if (typeof body.error === "string") code = body.error;
  } catch {
    // Non-JSON error body: keep the status text.
  }
  return new ApiError(res.status, message, code);
}

function withAuth(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  const token = readToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return { ...init, headers, credentials: "same-origin" };
}

/**
 * Authenticated fetch. Returns the Response only when it is 2xx; otherwise throws
 * ApiError (status 0 = network failure).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, withAuth(init));
    // Credential endpoints answer 401 for bad credentials; that is never a reason to refresh.
    if (res.status === 401 && !NO_REFRESH_URLS.has(url)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        setAccessToken(null);
        expiredListeners.forEach((listener) => listener());
        throw new ApiError(401, "Session expired", "unauthorized");
      }
      res = await fetch(url, withAuth(init));
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, err instanceof Error ? err.message : "Network error", "network");
  }

  if (!res.ok) throw await toApiError(res);
  return res;
}

/** apiFetch + JSON body. */
export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, init);
  return (await res.json()) as T;
}
