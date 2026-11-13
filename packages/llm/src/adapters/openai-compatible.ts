import { MeetingAnalysisSchema, findInvalidCitations, type MeetingAnalysis } from "@dawwen/shared";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmbeddingClient, LlmAnalysisResult, LlmClient, TranscriptContext } from "../types.js";
import { LlmAnalysisFailedError } from "../types.js";

/**
 * OpenAI-compatible chat + embeddings (ADR-026): Gemini's free tier
 * (https://generativelanguage.googleapis.com/v1beta/openai), Groq, OpenRouter, a local
 * vLLM... Same prompt, schema validation, citation check and repair loop as Bedrock.
 */
export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Retries of one HTTP call on 429/5xx (free tiers rate-limit per minute). */
  httpRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const here = dirname(fileURLToPath(import.meta.url));

function loadSystemPrompt(): string {
  try {
    return readFileSync(resolve(here, "../prompts/analysis.system.md"), "utf-8");
  } catch {
    return "You are the AI meeting analysis engine for Dawwen. Output valid JSON.";
  }
}

/** Thin fetch wrapper: JSON POST with bearer auth, timeout and 429/5xx retries. */
class OpenAiHttp {
  readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly retries: number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    if (!baseUrl?.trim()) throw new Error("OpenAI-compatible client requires LLM_BASE_URL");
    if (!apiKey?.trim()) throw new Error("OpenAI-compatible client requires LLM_API_KEY");
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < this.retries) {
          await this.sleep(Math.min(2 ** attempt * 2000, 60_000));
          continue;
        }
        const cause = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message;
        throw new Error(`OpenAI-compatible request to ${path} failed (${cause})`);
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) return (await response.json()) as T;
      if ((response.status === 429 || response.status >= 500) && attempt < this.retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 120) * 1000
            : Math.min(2 ** attempt * 2000, 60_000),
        );
        continue;
      }
      const text = (await response.text()).slice(0, 300);
      throw new Error(`OpenAI-compatible ${path} failed with HTTP ${response.status}: ${text}`);
    }
  }
}

export class OpenAiCompatibleLlmClient implements LlmClient {
  public readonly providerName = "openai-compatible";
  private readonly http: OpenAiHttp;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly systemPrompt = loadSystemPrompt();

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.model?.trim()) throw new Error("OpenAI-compatible client requires LLM_MODEL");
    this.model = config.model.trim();
    this.maxRetries = config.maxRetries ?? 3;
    this.temperature = config.temperature ?? 0.1;
    this.http = new OpenAiHttp(
      config.baseUrl,
      config.apiKey,
      config.timeoutMs ?? 180_000,
      config.httpRetries ?? 4,
      config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    );
  }

  buildUserMessage(context: TranscriptContext, now: Date = new Date()): string {
    const segments = context.segments
      .map(
        (s) =>
          `<segment id="${s.id}" speaker="${s.speakerLabel}" startMs="${s.startMs}" endMs="${s.endMs}">\n${s.text}\n</segment>`,
      )
      .join("\n");
    const day = meetingDay(context.scheduledStart ?? now);
    return `Here is the meeting transcript to analyze:
<meeting>
<title>${context.meetingTitle || "Untitled Meeting"}</title>
<date>${day.date} (${day.weekday}, Africa/Cairo)</date>
<language>${context.language || "ar-EG"}</language>
<transcript>
${segments}
</transcript>
</meeting>

The meeting took place on ${day.date}, a ${day.weekday}. Use it for meta.date and to turn relative
dates ("Thursday", "tomorrow", "next week") into YYYY-MM-DD. If a date cannot be pinned to one day,
set it to null and needsReview to true. Never use a date from your training data.

Extract the complete meeting analysis strictly matching the requested JSON schema. Return only the JSON object.`;
  }

  async analyzeMeeting(context: TranscriptContext): Promise<LlmAnalysisResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: this.buildUserMessage(context) },
    ];
    const validIds = new Set(context.segments.map((s) => s.id));
    let inputTokens = 0;
    let outputTokens = 0;
    let lastError = "";
    let lastSchemaValid: MeetingAnalysis | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let response: ChatResponse;
      try {
        response = await this.http.post<ChatResponse>("/chat/completions", {
          model: this.model,
          messages,
          temperature: this.temperature,
          response_format: { type: "json_object" },
        });
      } catch (err) {
        throw new LlmAnalysisFailedError(
          `${(err as Error).message} (attempt ${attempt})`,
          inputTokens,
          outputTokens,
          this.model,
        );
      }
      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      const output = response.choices?.[0]?.message?.content ?? "";

      try {
        const analysis = MeetingAnalysisSchema.parse(JSON.parse(stripFences(output)));
        // Invariant 2: every cited segment id must exist in this transcript.
        const problems = findInvalidCitations(analysis, validIds);
        if (problems.length > 0) {
          lastSchemaValid = analysis;
          throw new Error(
            `Citations must use only the segment ids given in <transcript>:\n${problems.join("\n")}`,
          );
        }
        return { analysis, inputTokens, outputTokens, modelName: this.model };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        messages.push({ role: "assistant", content: output });
        messages.push({
          role: "user",
          content: `The output failed validation with the following error:\n${lastError}\n\nPlease repair the JSON to strictly conform to the required MeetingAnalysisSchema. Return ONLY the repaired JSON.`,
        });
      }
    }

    if (lastSchemaValid) {
      return { analysis: lastSchemaValid, inputTokens, outputTokens, modelName: this.model };
    }
    throw new LlmAnalysisFailedError(
      `Meeting analysis failed after ${this.maxRetries} attempts. Last error: ${lastError}`,
      inputTokens,
      outputTokens,
      this.model,
    );
  }
}

export interface OpenAiCompatibleEmbeddingConfig extends Omit<
  OpenAiCompatibleConfig,
  "maxRetries"
> {
  /** Must match EMBEDDING_DIM (the pgvector column). */
  dimensions?: number;
  maxBatchSize?: number;
}

export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  public readonly providerName = "openai-compatible-embeddings";
  private readonly http: OpenAiHttp;
  private readonly model: string;
  private readonly dimensions?: number;
  private readonly maxBatchSize: number;

  constructor(config: OpenAiCompatibleEmbeddingConfig) {
    if (!config.model?.trim()) throw new Error("embedding client requires LLM_EMBEDDING_MODEL");
    this.model = config.model.trim();
    this.dimensions = config.dimensions;
    this.maxBatchSize = config.maxBatchSize ?? 50;
    this.http = new OpenAiHttp(
      config.baseUrl,
      config.apiKey,
      config.timeoutMs ?? 60_000,
      config.httpRetries ?? 4,
      config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    );
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const response = await this.http.post<{ data?: { index?: number; embedding: number[] }[] }>(
        "/embeddings",
        {
          model: this.model,
          input: batch,
          ...(this.dimensions ? { dimensions: this.dimensions } : {}),
        },
      );
      const data = [...(response.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== batch.length) {
        throw new Error(`embeddings returned ${data.length} vectors for ${batch.length} texts`);
      }
      for (const item of data) {
        if (this.dimensions && item.embedding.length !== this.dimensions) {
          throw new Error(
            `embedding has ${item.embedding.length} dimensions, EMBEDDING_DIM is ${this.dimensions}`,
          );
        }
        vectors.push(item.embedding);
      }
    }
    return vectors;
  }
}

/** Calendar day of the meeting in Cairo (the product's default timezone). */
function meetingDay(at: Date): { date: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}
