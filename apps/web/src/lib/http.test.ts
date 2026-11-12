import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchArgs = unknown[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

async function loadHttp() {
  vi.resetModules();
  return import("./http");
}

describe("apiFetch", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiError with the server message on non-2xx instead of faking success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: "conflict", message: "already executing" }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch, ApiError } = await loadHttp();

    const err = await apiFetch("/api/proposals/p1/approve", { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("already executing");
  });

  it("maps network failures to ApiError status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { apiFetch } = await loadHttp();

    await expect(apiFetch("/api/meetings")).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it.each(["/api/meetings", "/api/auth/me"])(
    "refreshes an expired token for %s (only credential endpoints are exempt)",
    async (url) => {
      store.set("dawwen_access_token", "old");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((u: string, init?: RequestInit) => {
          if (u === "/api/auth/refresh")
            return Promise.resolve(jsonResponse(200, { accessToken: "new" }));
          const auth = new Headers(init?.headers).get("Authorization");
          return Promise.resolve(
            auth === "Bearer new" ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}),
          );
        }),
      );
      const { apiJson } = await loadHttp();

      await expect(apiJson(url)).resolves.toEqual({ ok: true });
    },
  );

  it("refreshes once on 401 and retries with the new token", async () => {
    store.set("dawwen_access_token", "old");
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/auth/refresh")
        return Promise.resolve(jsonResponse(200, { accessToken: "new" }));
      const auth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        auth === "Bearer new" ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { apiJson } = await loadHttp();

    await expect(apiJson("/api/meetings")).resolves.toEqual({ ok: true });
    expect(store.get("dawwen_access_token")).toBe("new");
    expect(fetchMock.mock.calls.map((c: FetchArgs) => c[0])).toEqual([
      "/api/meetings",
      "/api/auth/refresh",
      "/api/meetings",
    ]);
  });

  it("shares one refresh between concurrent 401s", async () => {
    store.set("dawwen_access_token", "old");
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/auth/refresh")
        return Promise.resolve(jsonResponse(200, { accessToken: "new" }));
      const auth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(auth === "Bearer new" ? jsonResponse(200, {}) : jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await loadHttp();

    await Promise.all([apiFetch("/api/a"), apiFetch("/api/b"), apiFetch("/api/c")]);
    const refreshCalls = fetchMock.mock.calls.filter(
      (c: FetchArgs) => c[0] === "/api/auth/refresh",
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("clears the session and notifies listeners when refresh fails", async () => {
    store.set("dawwen_access_token", "old");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            jsonResponse(401, { error: url === "/api/auth/refresh" ? "bad refresh" : "x" }),
          ),
        ),
    );
    const { apiFetch, onSessionExpired } = await loadHttp();
    const listener = vi.fn();
    onSessionExpired(listener);

    await expect(apiFetch("/api/meetings")).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.has("dawwen_access_token")).toBe(false);
  });

  it("reports a wrong password as-is without attempting a refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { error: "Unauthorized", message: "Invalid email or password" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch, onSessionExpired } = await loadHttp();
    const listener = vi.fn();
    onSessionExpired(listener);

    await expect(apiFetch("/api/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject(
      { status: 401, message: "Invalid email or password" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("proposalErrorKey", () => {
  it("maps known API refusal codes to their i18n keys and falls back to generic", async () => {
    const { ApiError } = await import("./http");
    const { proposalErrorKey } = await import("./proposal-errors");
    expect(proposalErrorKey(new ApiError(422, "x", "calendar_not_connected"))).toBe(
      "proposals.errors.calendar_not_connected",
    );
    expect(proposalErrorKey(new ApiError(500, "x", "boom"))).toBe("errors.generic");
    expect(proposalErrorKey(new Error("x"))).toBe("errors.generic");
  });
});
