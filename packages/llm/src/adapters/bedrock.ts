import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { MeetingAnalysisSchema, type MeetingAnalysis } from "@dawwen/shared";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmClient, TranscriptContext, LlmAnalysisResult } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BedrockConfig {
  region?: string;
  modelId?: string;
  maxRetries?: number;
  temperature?: number;
  endpointUrl?: string; // LocalStack support
}

export class BedrockLlmClient implements LlmClient {
  public readonly providerName = "bedrock";
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly systemPrompt: string;

  constructor(config?: BedrockConfig) {
    this.modelId =
      config?.modelId ||
      process.env.BEDROCK_MODEL_ID ||
      "anthropic.claude-3-5-sonnet-20241022-v2:0";
    this.maxRetries = config?.maxRetries ?? 3;
    this.temperature = config?.temperature ?? 0.1;

    this.client = new BedrockRuntimeClient({
      region: config?.region || process.env.AWS_REGION || "eu-central-1",
      endpoint: config?.endpointUrl || process.env.AWS_ENDPOINT_URL,
    });

    const promptPath = resolve(__dirname, "../prompts/analysis.system.md");
    try {
      this.systemPrompt = readFileSync(promptPath, "utf-8");
    } catch {
      this.systemPrompt = "You are the AI meeting analysis engine for Dawwen. Output valid JSON.";
    }
  }

  buildUserMessage(context: TranscriptContext): string {
    const segmentsXml = context.segments
      .map(
        (s) =>
          `<segment id="${s.id}" speaker="${s.speakerLabel}" startMs="${s.startMs}" endMs="${s.endMs}">\n${s.text}\n</segment>`,
      )
      .join("\n");

    return `Here is the meeting transcript to analyze:
<meeting>
<title>${context.meetingTitle || "Untitled Meeting"}</title>
<language>${context.language || "ar-EG"}</language>
<transcript>
${segmentsXml}
</transcript>
</meeting>

Extract the complete meeting analysis strictly matching the requested JSON schema.`;
  }

  cleanJsonText(text: string): string {
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    return cleaned.trim();
  }

  async analyzeMeeting(context: TranscriptContext): Promise<LlmAnalysisResult> {
    const userPrompt = this.buildUserMessage(context);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ text: userPrompt }],
      },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastError = "";

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const command = new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: this.systemPrompt }],
        messages,
        inferenceConfig: {
          temperature: this.temperature,
          maxTokens: 4096,
        },
      });

      const response = await this.client.send(command);

      const usage = response.usage;
      totalInputTokens += usage?.inputTokens || 0;
      totalOutputTokens += usage?.outputTokens || 0;

      const outputContent = response.output?.message?.content?.[0]?.text || "";
      const cleanedJson = this.cleanJsonText(outputContent);

      try {
        const parsedJson = JSON.parse(cleanedJson);
        const analysis: MeetingAnalysis = MeetingAnalysisSchema.parse(parsedJson);

        return {
          analysis,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelName: this.modelId,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);

        // Append assistant response and repair prompt for the next turn
        messages.push({
          role: "assistant",
          content: [{ text: outputContent }],
        });
        messages.push({
          role: "user",
          content: [
            {
              text: `The output failed validation with the following error:\n${lastError}\n\nPlease repair the JSON to strictly conform to the required MeetingAnalysisSchema. Return ONLY the repaired JSON.`,
            },
          ],
        });
      }
    }

    throw new Error(
      `Bedrock meeting analysis failed after ${this.maxRetries} attempts. Last error: ${lastError}`,
    );
  }
}
