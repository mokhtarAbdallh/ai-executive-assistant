import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring OAuth `state` (ADR-023). Google's redirect to
 * GET /api/calendar/callback carries no Bearer token, so the state is what ties
 * the callback to the user who started the flow. It is HMAC-signed with a key
 * derived from APP_SECRET, so it cannot be forged or pointed at another user.
 */
const DEFAULT_TTL_MS = 10 * 60_000;

interface StatePayload {
  uid: string;
  exp: number;
  n: string;
}

export class InvalidOAuthStateError extends Error {
  constructor(reason: string) {
    super(`Invalid OAuth state: ${reason}`);
    this.name = "InvalidOAuthStateError";
  }
}

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`dawwen:oauth-state:${secret}`).digest();
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function createOAuthState(
  secret: string,
  userId: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): string {
  const payload: StatePayload = {
    uid: userId,
    exp: now + ttlMs,
    n: randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(keyFrom(secret), body)}`;
}

/** Returns the user id the state was issued to, or throws InvalidOAuthStateError. */
export function verifyOAuthState(secret: string, state: string, now = Date.now()): string {
  const [body, signature, extra] = state.split(".");
  if (!body || !signature || extra !== undefined) throw new InvalidOAuthStateError("malformed");

  const expected = Buffer.from(sign(keyFrom(secret), body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new InvalidOAuthStateError("bad signature");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    throw new InvalidOAuthStateError("malformed");
  }
  if (typeof payload.uid !== "string" || typeof payload.exp !== "number") {
    throw new InvalidOAuthStateError("malformed");
  }
  if (payload.exp < now) throw new InvalidOAuthStateError("expired");
  return payload.uid;
}
