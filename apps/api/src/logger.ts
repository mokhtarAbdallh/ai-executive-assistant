import type { FastifyServerOptions } from "fastify";

/**
 * Structured JSON logs. Invariant 5: never log transcripts, tokens or secrets —
 * sensitive paths are redacted defensively even if someone logs a whole request.
 */
export function loggerOptions(level: string): FastifyServerOptions["logger"] {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "*.password",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.transcript",
        "*.text",
      ],
      censor: "[redacted]",
    },
  };
}
