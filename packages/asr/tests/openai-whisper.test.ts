import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiWhisperSpeechToText, createSpeechToText } from "../src/index.js";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> } | Error;

function mockFetch(replies: Reply[]) {
  const calls: { url: string; form: FormData }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), form: init?.body as FormData });
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error("unexpected extra fetch call");
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: new Headers(reply.headers ?? {}),
      text: async () => JSON.stringify(reply.body),
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const audio = new Uint8Array([1, 2, 3]);
const noSleep = async () => undefined;

afterEach(() => vi.restoreAllMocks());

describe("OpenAI-compatible Whisper adapter (ADR-026)", () => {
  it("sends model, language and verbose_json, and keeps real sentence timestamps", async () => {
    const fetch = mockFetch([
      {
        body: {
          language: "arabic",
          duration: 20,
          segments: [
            { start: 0, end: 4.5, text: " هنبدأ بالـ sprint review" },
            { start: 4.5, end: 9, text: "سارة هتبعت التصميم" },
          ],
        },
      },
    ]);
    const asr = new OpenAiWhisperSpeechToText({
      baseUrl: "https://api.groq.com/openai/v1/",
      apiKey: "k",
      model: "whisper-large-v3",
    });

    const result = await asr.transcribe(audio, { language: "ar-EG" });
    fetch.restore();

    expect(fetch.calls[0]!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(fetch.calls[0]!.form.get("model")).toBe("whisper-large-v3");
    expect(fetch.calls[0]!.form.get("language")).toBe("ar");
    expect(fetch.calls[0]!.form.get("response_format")).toBe("verbose_json");
    expect(result.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 4500],
      [4500, 9000],
    ]);
    expect(result.segments[0]!.speakerLabel).toBe("Speaker 1");
    expect(result.durationSeconds).toBe(20);
  });

  it("offsets chunk timestamps, drops the lead-in repeat and Whisper's silence inventions", async () => {
    const fetch = mockFetch([
      { body: { segments: [{ start: 0, end: 19, text: "الجزء الأول" }] } },
      {
        // This chunk file starts 2 s early (lead-in): its first sentence repeats chunk 1.
        body: {
          segments: [
            { start: 0, end: 1.5, text: "الأول" },
            { start: 2, end: 10, text: "الجزء التاني" },
            { start: 10, end: 22, text: "اشتركوا في القناة", no_speech_prob: 0.9 },
          ],
        },
      },
    ]);
    const asr = new OpenAiWhisperSpeechToText({ baseUrl: "http://asr", concurrency: 1 });

    const result = await asr.transcribeChunked([
      { buffer: audio, startMs: 0, endMs: 20_000 },
      { buffer: audio, startMs: 20_000, endMs: 40_000, leadInMs: 2000 },
    ]);
    fetch.restore();

    expect(result.segments.map((s) => [s.text, s.startMs, s.endMs])).toEqual([
      ["الجزء الأول", 0, 19_000],
      ["الجزء التاني", 20_000, 28_000],
    ]);
    expect(result.text).toBe("الجزء الأول الجزء التاني");
    expect(result.durationSeconds).toBe(40);
  });

  it("waits and retries when the free tier says 429, then fails clearly on 4xx", async () => {
    const sleep = vi.fn(noSleep);
    const fetch = mockFetch([
      { status: 429, body: { error: "rate limit" }, headers: { "retry-after": "7" } },
      { body: { text: "تمام", duration: 3 } },
      { status: 400, body: { error: { message: "file too large" } } },
    ]);
    const asr = new OpenAiWhisperSpeechToText({ baseUrl: "http://asr", sleep });

    const ok = await asr.transcribe(audio);
    await expect(asr.transcribe(audio)).rejects.toThrow(/HTTP 400.*file too large/);
    fetch.restore();

    expect(sleep).toHaveBeenCalledWith(7000);
    expect(ok.segments).toEqual([
      { id: "seg-1", speakerLabel: "Speaker 1", startMs: 0, endMs: 3000, text: "تمام" },
    ]);
  });

  it("is built by the factory as openai-whisper", () => {
    const asr = createSpeechToText({
      provider: "openai-whisper",
      http: { baseUrl: "http://asr", model: "whisper-large-v3" },
    });
    expect(asr.providerName).toBe("openai-whisper");
    expect(() => createSpeechToText({ provider: "openai-whisper", http: { baseUrl: "" } })).toThrow(
      /ASR_HTTP_URL/,
    );
  });
});
