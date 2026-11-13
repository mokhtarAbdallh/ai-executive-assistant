import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeLlmClient,
  LlmAnalysisFailedError,
  OpenAiCompatibleEmbeddingClient,
  OpenAiCompatibleLlmClient,
  createLlmClient,
  type TranscriptContext,
} from "../src/index.js";

type Reply = { status?: number; body: unknown };

function mockFetch(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies[bodies.length - 1];
    if (!reply) throw new Error("unexpected extra fetch call");
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: new Headers(),
      text: async () => JSON.stringify(reply.body),
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { urls, bodies, restore: () => (globalThis.fetch = original) };
}

const chat = (content: string, prompt = 100, completion = 50) => ({
  body: {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion },
  },
});

const context: TranscriptContext = {
  meetingTitle: "Sprint",
  segments: [
    { id: "seg-101", speakerLabel: "S1", startMs: 0, endMs: 5000, text: "هنبدأ" },
    { id: "seg-102", speakerLabel: "S1", startMs: 5000, endMs: 9000, text: "خلصت الـ API" },
  ],
};

const config = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: "k",
  model: "gemini-2.5-flash",
  sleep: async () => undefined,
};

afterEach(() => vi.restoreAllMocks());

describe("OpenAI-compatible LLM (ADR-026)", () => {
  it("asks for a JSON object and returns the validated analysis with token usage", async () => {
    const { analysis } = await new FakeLlmClient().analyzeMeeting(context);
    const fetch = mockFetch([chat("```json\n" + JSON.stringify(analysis) + "\n```")]);

    const result = await new OpenAiCompatibleLlmClient(config).analyzeMeeting(context);
    fetch.restore();

    expect(fetch.urls[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(fetch.bodies[0]).toMatchObject({
      model: "gemini-2.5-flash",
      response_format: { type: "json_object" },
    });
    expect(result).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      modelName: "gemini-2.5-flash",
    });
    expect(result.analysis.tldr).toBe(analysis.tldr);
  });

  it("tells the model the meeting date so relative dates are not invented", () => {
    const client = new OpenAiCompatibleLlmClient(config);
    // 2026-11-12 23:30 UTC is already Friday 13 in Cairo.
    const message = client.buildUserMessage(context, new Date("2026-11-12T23:30:00Z"));
    expect(message).toContain("<date>2026-11-13 (Friday, Africa/Cairo)</date>");
    const scheduled = client.buildUserMessage({
      ...context,
      scheduledStart: new Date("2026-01-05T10:00:00Z"),
    });
    expect(scheduled).toContain("2026-01-05 (Monday");
  });

  it("sends invalid output back for repair and sums tokens over attempts", async () => {
    const { analysis } = await new FakeLlmClient().analyzeMeeting(context);
    const fetch = mockFetch([chat("not json"), chat(JSON.stringify(analysis), 300, 70)]);

    const result = await new OpenAiCompatibleLlmClient(config).analyzeMeeting(context);
    fetch.restore();

    const repairTurn = (fetch.bodies[1]!.messages as { role: string; content: string }[]).at(-1)!;
    expect(repairTurn.content).toMatch(/failed validation/);
    expect(result).toMatchObject({ inputTokens: 400, outputTokens: 120 });
  });

  it("keeps the spent tokens when the provider fails (metering, Invariant 7)", async () => {
    const fetch = mockFetch([chat("{}", 80, 5), { status: 401, body: { error: "bad key" } }]);

    const err = await new OpenAiCompatibleLlmClient(config).analyzeMeeting(context).catch((e) => e);
    fetch.restore();

    expect(err).toBeInstanceOf(LlmAnalysisFailedError);
    expect(err).toMatchObject({ inputTokens: 80, outputTokens: 5 });
    expect(err.message).toMatch(/HTTP 401/);
  });

  it("requires base URL, key and model through the factory", () => {
    expect(() =>
      createLlmClient({
        provider: "openai-compatible",
        openaiCompatible: { ...config, model: "" },
      }),
    ).toThrow(/LLM_MODEL/);
    expect(
      createLlmClient({ provider: "openai-compatible", openaiCompatible: config }).providerName,
    ).toBe("openai-compatible");
  });
});

describe("OpenAI-compatible embeddings (ADR-026)", () => {
  it("batches, keeps input order and checks the vector size against EMBEDDING_DIM", async () => {
    const fetch = mockFetch([
      {
        body: {
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        },
      },
      { body: { data: [{ index: 0, embedding: [1, 1, 1] }] } },
    ]);
    const client = new OpenAiCompatibleEmbeddingClient({
      ...config,
      model: "gemini-embedding-001",
      dimensions: 2,
      maxBatchSize: 2,
    });

    const vectors = await client.embed(["a", "b"]);
    await expect(client.embed(["c"])).rejects.toThrow(/3 dimensions, EMBEDDING_DIM is 2/);
    fetch.restore();

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetch.bodies[0]).toEqual({
      model: "gemini-embedding-001",
      input: ["a", "b"],
      dimensions: 2,
    });
  });
});
