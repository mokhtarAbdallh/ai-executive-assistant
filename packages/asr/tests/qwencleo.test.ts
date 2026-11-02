import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QwenCleoHttpSpeechToText,
  createSpeechToText,
} from "../src/index.js";

/** Installs a fetch mock for successive /v1/transcribe calls. */
function mockFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const response = responses[calls.length - 1];
    if (!response) throw new Error("unexpected extra fetch call");
    if (response instanceof Error) throw response;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => JSON.stringify(response.body),
      json: async () => response.body,
    } as Response;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    calls,
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QwenCleoHttpSpeechToText (ADR-018)", () => {
  it("requires a baseUrl", () => {
    expect(() => new QwenCleoHttpSpeechToText({ baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("maps a single /v1/transcribe response to one full-length segment", async () => {
    const mock = mockFetch([{ body: { text: "قهوة قدامه", language: "Arabic" } }]);

    const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000/" });
    const result = await asr.transcribe(Buffer.from("wav"), { audioDurationSeconds: 30 });

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe("http://asr:8000/v1/transcribe");
    expect(result.text).toBe("قهوة قدامه");
    expect(result.language).toBe("Arabic");
    expect(result.durationSeconds).toBe(30);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      speakerLabel: "Speaker 1",
      startMs: 0,
      endMs: 30_000,
      text: "قهوة قدامه",
    });

    mock.restore();
  });

  it("sends the Arabic language hint and Authorization header when configured", async () => {
    const mock = mockFetch([{ body: { text: "خذ بريك", language: "Arabic" } }]);

    const asr = new QwenCleoHttpSpeechToText({
      baseUrl: "http://asr:8000",
      apiKey: "shared-key",
    });
    await asr.transcribe(Buffer.from("wav"), { language: "ar" });

    const init = mock.calls[0]!.init as RequestInit & { headers?: Record<string, string> };
    const headers = init.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer shared-key");
    const body = init.body as FormData;
    expect(body.get("language")).toBe("Arabic");

    mock.restore();
  });

  it("transcribes chunks sequentially and merges them with real timestamps", async () => {
    const mock = mockFetch([
      { body: { text: "افتح الملف", language: "Arabic" } },
      { body: { text: "وكدا التسليم", language: "Arabic" } },
    ]);

    const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000" });
    const result = await asr.transcribeChunked([
      { buffer: Buffer.from("c1"), startMs: 0, endMs: 20_000 },
      { buffer: Buffer.from("c2"), startMs: 20_000, endMs: 38_000 },
    ]);

    expect(mock.calls).toHaveLength(2);
    expect(result.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs }))).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 20_000, endMs: 38_000 },
    ]);
    expect(result.text).toBe("افتح الملف وكدا التسليم");
    expect(result.durationSeconds).toBe(38);

    mock.restore();
  });

  it("throws a descriptive error for HTTP failures", async () => {
    const mock = mockFetch([{ ok: false, status: 500, body: { detail: "boom" } }]);

    const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000" });
    await expect(asr.transcribe(Buffer.from("wav"))).rejects.toThrow(
      /QwenCleo-ASR transcription failed with HTTP 500/,
    );

    mock.restore();
  });

  it("throws on fetch failures", async () => {
    const mock = mockFetch([new Error("connect ECONNREFUSED")]);

    const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000" });
    await expect(asr.transcribe(Buffer.from("wav"))).rejects.toThrow(
      /QwenCleo-ASR request failed/,
    );

    mock.restore();
  });
});

describe("createSpeechToText factory: qwencleo-http", () => {
  it("builds the adapter from explicit options", () => {
    const asr = createSpeechToText({
      provider: "qwencleo-http",
      http: { baseUrl: "http://asr:8000" },
    });
    expect(asr.providerName).toBe("qwencleo-http");
  });
});
