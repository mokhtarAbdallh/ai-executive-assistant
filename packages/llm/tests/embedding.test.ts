import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BedrockEmbeddingClient,
  FakeEmbeddingClient,
  createEmbeddingClient,
} from "../src/index.js";
import type { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

afterEach(() => {
  vi.restoreAllMocks();
});

interface SendCapableClient {
  client: { send: (...args: unknown[]) => Promise<unknown> };
}

describe("Semantic search embeddings (ADR-016)", () => {
  it("FakeEmbeddingClient returns stable, unit-norm vectors", async () => {
    const client = new FakeEmbeddingClient(8);
    const [a, b] = await client.embed(["اجتماع الفريق", "مراجعة الميزانية"]);
    expect(a).toHaveLength(8);
    expect(await client.embed(["اجتماع الفريق"])).toEqual([a]);
    const norm = Math.sqrt(a!.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(b).toBeDefined();
  });

  it("BedrockEmbeddingClient requires a model id", () => {
    const original = process.env.BEDROCK_EMBEDDING_MODEL_ID;
    delete process.env.BEDROCK_EMBEDDING_MODEL_ID;
    try {
      expect(() => new BedrockEmbeddingClient()).toThrow(/BEDROCK_EMBEDDING_MODEL_ID/);
    } finally {
      if (original) process.env.BEDROCK_EMBEDDING_MODEL_ID = original;
    }
  });

  it("Titan v2 request carries input.text; response vector is returned", async () => {
    const originalModel = process.env.BEDROCK_EMBEDDING_MODEL_ID;
    process.env.BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
    const originalRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = "eu-central-1";
    try {
      const client = new BedrockEmbeddingClient({ dimensions: 1024 });
      const sendSpy = vi
        .spyOn((client as unknown as SendCapableClient).client, "send")
        .mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3] })),
        });

      const [vector] = await client.embed(["قناة YouTube"]);

      const sent = (sendSpy.mock.calls as unknown[][])[0]![0] as InvokeModelCommand;
      const body = JSON.parse(sent.input.body as string) as {
        input: { text: string };
        dimensions: number;
        normalize: boolean;
      };
      expect(body.input.text).toBe("قناة YouTube");
      expect(body.dimensions).toBe(1024);
      expect(body.normalize).toBe(true);
      expect(vector).toEqual([0.1, 0.2, 0.3]);
    } finally {
      if (originalModel) process.env.BEDROCK_EMBEDDING_MODEL_ID = originalModel;
      else delete process.env.BEDROCK_EMBEDDING_MODEL_ID;
      if (originalRegion) process.env.AWS_REGION = originalRegion;
    }
  });

  it("v1 model ids use the inputText request shape", async () => {
    const originalModel = process.env.BEDROCK_EMBEDDING_MODEL_ID;
    process.env.BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v1";
    try {
      const client = new BedrockEmbeddingClient();
      const sendSpy = vi
        .spyOn((client as unknown as SendCapableClient).client, "send")
        .mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({ embedding: [1, 0] })),
        });

      const [vector] = await client.embed(["مرحبا"]);
      const sent = (sendSpy.mock.calls as unknown[][])[0]![0] as InvokeModelCommand;
      expect(JSON.parse(sent.input.body as string)).toMatchObject({ inputText: "مرحبا" });
      expect(vector).toEqual([1, 0]);
    } finally {
      if (originalModel) process.env.BEDROCK_EMBEDDING_MODEL_ID = originalModel;
      else delete process.env.BEDROCK_EMBEDDING_MODEL_ID;
    }
  });

  it("factory: bedrock provider builds BedrockEmbeddingClient", () => {
    const client = createEmbeddingClient({
      provider: "bedrock",
      bedrock: { modelId: "amazon.titan-embed-text-v2:0" },
    });
    expect(client.providerName).toBe("bedrock-embeddings");
  });
});
