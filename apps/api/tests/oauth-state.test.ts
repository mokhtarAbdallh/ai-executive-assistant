import { describe, expect, it } from "vitest";
import {
  createOAuthState,
  InvalidOAuthStateError,
  verifyOAuthState,
} from "../src/services/oauth-state.js";

describe("OAuth state (ADR-023)", () => {
  const secret = "test-secret-key-that-is-at-least-32-chars-long";

  it("round-trips the user id", () => {
    expect(verifyOAuthState(secret, createOAuthState(secret, "user-1"))).toBe("user-1");
  });

  it("rejects a state signed with another secret", () => {
    const state = createOAuthState("another-secret-that-is-also-long-enough", "user-1");
    expect(() => verifyOAuthState(secret, state)).toThrow(InvalidOAuthStateError);
  });

  it("rejects a state whose user id was swapped", () => {
    const [, sig] = createOAuthState(secret, "user-1").split(".");
    const body = Buffer.from(
      JSON.stringify({ uid: "victim", exp: Date.now() + 60_000, n: "x" }),
    ).toString("base64url");
    expect(() => verifyOAuthState(secret, `${body}.${sig}`)).toThrow(/bad signature/);
  });

  it("expires", () => {
    const state = createOAuthState(secret, "user-1", Date.now() - 11 * 60_000);
    expect(() => verifyOAuthState(secret, state)).toThrow(/expired/);
  });
});
