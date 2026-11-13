import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";

/** Bedrock's JSON "document" type (tool inputs/results). */
type DocumentType = NonNullable<ToolUseBlock["input"]>;

/**
 * Tool-using chat model for the Ask assistant (ADR-024). Provider-neutral
 * shapes; `BedrockAgentChatModel` maps them onto the Bedrock Converse API.
 */
export interface AgentToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool input (object). */
  inputSchema: Record<string, unknown>;
}

export type AgentAssistantBlock =
  { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

export type AgentUserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; toolUseId: string; content: unknown; isError?: boolean };

export type AgentMessage =
  | { role: "user"; content: AgentUserBlock[] }
  | { role: "assistant"; content: AgentAssistantBlock[] };

export interface AgentTurn {
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  content: AgentAssistantBlock[];
  inputTokens: number;
  outputTokens: number;
  modelName: string;
}

export interface AgentConverseRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolSpec[];
  maxTokens?: number;
}

export interface AgentChatModel {
  readonly providerName: string;
  converse(request: AgentConverseRequest): Promise<AgentTurn>;
}

export interface BedrockAgentConfig {
  region?: string;
  modelId?: string;
  endpointUrl?: string;
  temperature?: number;
}

export class BedrockAgentChatModel implements AgentChatModel {
  public readonly providerName = "bedrock";
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly temperature: number;

  constructor(config?: BedrockAgentConfig) {
    this.modelId =
      config?.modelId ||
      process.env.BEDROCK_MODEL_ID ||
      "anthropic.claude-3-5-sonnet-20241022-v2:0";
    this.temperature = config?.temperature ?? 0.2;
    this.client = new BedrockRuntimeClient({
      region: config?.region || process.env.AWS_REGION || "eu-central-1",
      endpoint: config?.endpointUrl || process.env.AWS_ENDPOINT_URL,
    });
  }

  async converse(request: AgentConverseRequest): Promise<AgentTurn> {
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: request.system }],
        messages: request.messages.map(toBedrockMessage),
        toolConfig: {
          tools: request.tools.map((t): Tool => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.inputSchema as DocumentType },
            },
          })),
        },
        inferenceConfig: { temperature: this.temperature, maxTokens: request.maxTokens ?? 1500 },
      }),
    );

    const content: AgentAssistantBlock[] = [];
    for (const block of response.output?.message?.content ?? []) {
      if (block.text !== undefined) content.push({ type: "text", text: block.text });
      else if (block.toolUse?.toolUseId && block.toolUse.name) {
        content.push({
          type: "tool_use",
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          input: block.toolUse.input ?? {},
        });
      }
    }

    const stop = response.stopReason;
    return {
      stopReason:
        stop === "end_turn" || stop === "tool_use" || stop === "max_tokens" ? stop : "other",
      content,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      modelName: this.modelId,
    };
  }
}

function toBedrockMessage(message: AgentMessage): Message {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content.map((b): ContentBlock =>
        b.type === "text"
          ? { text: b.text }
          : { toolUse: { toolUseId: b.id, name: b.name, input: b.input as DocumentType } },
      ),
    };
  }
  return {
    role: "user",
    content: message.content.map((b): ContentBlock =>
      b.type === "text"
        ? { text: b.text }
        : {
            toolResult: {
              toolUseId: b.toolUseId,
              content: [{ json: b.content as DocumentType }],
              status: b.isError ? "error" : "success",
            },
          },
    ),
  };
}
