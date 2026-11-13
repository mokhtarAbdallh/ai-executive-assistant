import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingClient } from "../types.js";

export interface BedrockEmbeddingConfig {
  /** e.g. "amazon.titan-embed-text-v2:0" (v2) or "amazon.titan-embed-image-v1"-style v1 ids. */
  modelId?: string;
  region?: string;
  endpointUrl?: string;
  /** Vector dimension; v2 supports 256/512/1024, must match EMBEDDING_DIM. */
  dimensions?: number;
  normalize?: boolean;
  maxBatchSize?: number;
}

interface TitanEmbedResponse {
  embedding?: number[];
}

/**
 * Amazon Titan Text Embeddings adapter for semantic search (ADR-016).
 * Detects the Titan v1/v2 request/response shapes from the model id and always
 * returns vectors as plain number arrays (stored in pgvector via casting).
 */
export class BedrockEmbeddingClient implements EmbeddingClient {
  public readonly providerName = "bedrock-embeddings";
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly dimensions?: number;
  private readonly normalize: boolean;
  private readonly maxBatchSize: number;

  constructor(config?: BedrockEmbeddingConfig) {
    this.modelId = config?.modelId || process.env.BEDROCK_EMBEDDING_MODEL_ID || "";
    if (!this.modelId) {
      throw new Error(
        "BedrockEmbeddingClient requires modelId. Set BEDROCK_EMBEDDING_MODEL_ID in the environment.",
      );
    }
    this.client = new BedrockRuntimeClient({
      region: config?.region || process.env.AWS_REGION || "eu-central-1",
      endpoint: config?.endpointUrl || process.env.AWS_ENDPOINT_URL,
    });
    this.dimensions = config?.dimensions;
    this.normalize = config?.normalize ?? true;
    this.maxBatchSize = config?.maxBatchSize ?? 32;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      for (const text of batch) {
        results.push(await this.embedOne(text));
      }
    }
    return results;
  }

  private async embedOne(text: string): Promise<number[]> {
    const isV2 = /titan-embed(-text)?-v2|embed-text-v2/.test(this.modelId);
    const body = isV2
      ? {
          input: { text },
          ...(this.dimensions ? { dimensions: this.dimensions } : {}),
          ...(this.normalize ? { normalize: this.normalize } : {}),
        }
      : { inputText: text };

    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      }),
    );

    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as TitanEmbedResponse;
    if (!parsed.embedding || parsed.embedding.length === 0) {
      throw new Error(`Bedrock embedding returned no vector for model ${this.modelId}`);
    }
    return parsed.embedding;
  }
}

/**
 * Deterministic offline embedding client (tests / DEMO_MODE). Hash-derived could
 * mislead similarity checks, so similarity is simply stable per-text.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  public readonly providerName = "fake-embeddings";
  constructor(private readonly dimensions = 8) {}

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    // Simple deterministic pseudo-embedding: sum of char codes into buckets.
    const vector = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      vector[i % this.dimensions]! += text.charCodeAt(i) % 7;
    }
    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
