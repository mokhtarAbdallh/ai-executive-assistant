import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("api foundation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ corsOrigins: ["http://localhost:5173"], logLevel: "silent" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health returns 200 (ALB health check contract)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("does not expose routes outside /api (Invariant 6)", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(404);
  });

  it("sets security headers (helmet)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("only allows configured CORS origins", async () => {
    const allowed = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const denied = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
