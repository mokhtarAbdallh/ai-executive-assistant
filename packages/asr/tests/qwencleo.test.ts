import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QwenCleoHttpSpeechToText,
  createSpeechToText,
  mapWithConcurrency,
  removeOverlapPrefix,
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

  it("transcribes chunks and merges them with real timestamps", async () => {
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

  it("transcribes several chunks at once but merges them in order (ADR-024)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const file = (init?.body as FormData).get("file") as Blob;
      const label = await file.text();
      // Later chunks answer first, so ordering cannot come from completion order.
      await new Promise((r) => setTimeout(r, 40 - Number(label.slice(1)) * 5));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({ text: `text ${label}` }) } as Response;
    }) as typeof fetch;

    try {
      const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000", concurrency: 3 });
      const chunks = Array.from({ length: 6 }, (_, i) => ({
        buffer: Buffer.from(`c${i}`),
        startMs: i * 20_000,
        endMs: (i + 1) * 20_000,
      }));
      const result = await asr.transcribeChunked(chunks);

      expect(maxInFlight).toBe(3);
      expect(result.segments.map((s) => s.text)).toEqual([
        "text c0",
        "text c1",
        "text c2",
        "text c3",
        "text c4",
        "text c5",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads chunks from disk and removes words repeated by the overlap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "asr-test-"));
    try {
      await writeFile(join(dir, "a.wav"), "a");
      await writeFile(join(dir, "b.wav"), "b");
      const mock = mockFetch([
        { body: { text: "هنسلم الـ release يوم الخميس الجاي" } },
        { body: { text: "الخميس الجاي إن شاء الله" } },
      ]);

      const asr = new QwenCleoHttpSpeechToText({ baseUrl: "http://asr:8000", concurrency: 1 });
      const result = await asr.transcribeChunked([
        { path: join(dir, "a.wav"), startMs: 0, endMs: 20_000 },
        { path: join(dir, "b.wav"), startMs: 20_000, endMs: 30_000, leadInMs: 2_000 },
      ]);

      expect(await ((mock.calls[0]!.init.body as FormData).get("file") as Blob).text()).toBe("a");
      expect(result.segments[1]).toMatchObject({ startMs: 20_000, text: "إن شاء الله" });
      expect(result.text).toBe("هنسلم الـ release يوم الخميس الجاي إن شاء الله");
      mock.restore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

describe("chunk helpers (ADR-024)", () => {
  it("removeOverlapPrefix drops the longest repeated run, ignoring punctuation and hamza", () => {
    expect(removeOverlapPrefix("we ship on Thursday.", "on thursday and then review")).toBe(
      "and then review",
    );
    expect(removeOverlapPrefix("اتفقنا على أحمد", "احمد هيبعت التقرير")).toBe("هيبعت التقرير");
  });

  it("removeOverlapPrefix keeps the text when nothing (or only a tiny word) repeats", () => {
    expect(removeOverlapPrefix("first part", "second part")).toBe("second part");
    expect(removeOverlapPrefix("قال و", "و بعدين")).toBe("و بعدين");
  });

  it("mapWithConcurrency stops starting work after a failure", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
        started.push(n);
        if (n === 0) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 10));
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
  });
});
