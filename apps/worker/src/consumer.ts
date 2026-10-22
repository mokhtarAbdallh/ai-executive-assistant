import type { SQSClient } from "@aws-sdk/client-sqs";
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import type { PipelineDependencies, PipelineResult } from "./pipeline.js";
import { processMeetingAudio } from "./pipeline.js";

export interface ParsedAudioMessage {
  meetingId: string;
  userId: string;
  s3Bucket: string;
  s3Key: string;
}

/**
 * Parse an SQS message body which may either be:
 * 1. Direct JSON: { meetingId, userId, s3Bucket, s3Key }
 * 2. S3 Event notification: { Records: [ { s3: { bucket: { name }, object: { key } } } ] }
 *    where S3 key format is `uploads/{userId}/{meetingId}/{fileName}`
 */
export function parseSqsMessage(body: string): ParsedAudioMessage | "TEST_EVENT" | null {
  try {
    const parsed = JSON.parse(body);

    // Direct JSON format
    if (parsed.meetingId && parsed.userId && parsed.s3Bucket && parsed.s3Key) {
      return {
        meetingId: parsed.meetingId,
        userId: parsed.userId,
        s3Bucket: parsed.s3Bucket,
        s3Key: parsed.s3Key,
      };
    }

    // S3 Event notification format
    if (parsed.Event === "s3:TestEvent" || parsed.Records?.[0]?.eventName === "s3:TestEvent") {
      return "TEST_EVENT";
    }

    if (Array.isArray(parsed.Records) && parsed.Records.length > 0) {
      const record = parsed.Records[0];
      const s3Bucket = record.s3?.bucket?.name;
      const rawKey = record.s3?.object?.key;

      if (!s3Bucket || !rawKey) {
        return null;
      }

      // S3 keys are URL-encoded in event notifications (+ is space, %2F is /)
      const decodedKey = decodeURIComponent(rawKey.replace(/\+/g, " "));

      // Expected pattern: uploads/{userId}/{meetingId}/{fileName}
      const match = decodedKey.match(/^uploads\/([^/]+)\/([^/]+)\/(.+)$/);
      if (match) {
        const userId = match[1];
        const meetingId = match[2];
        if (userId && meetingId) {
          return {
            meetingId,
            userId,
            s3Bucket,
            s3Key: decodedKey,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export class SqsAudioConsumer {
  private isPolling = false;

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
    private readonly pipelineDeps: PipelineDependencies,
    private readonly log: {
      info: (msg: string, meta?: Record<string, unknown>) => void;
      warn: (msg: string, meta?: Record<string, unknown>) => void;
      error: (msg: string, meta?: Record<string, unknown>) => void;
    } = {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  ) {}

  /**
   * Process a single SQS message
   */
  async processSingleMessage(message: Message): Promise<PipelineResult | null> {
    if (!message.Body || !message.ReceiptHandle) {
      return null;
    }

    const parsed = parseSqsMessage(message.Body);

    if (parsed === "TEST_EVENT") {
      this.log.info("ignoring s3:TestEvent");
      await this.deleteMessage(message.ReceiptHandle);
      return null;
    }

    if (!parsed) {
      this.log.warn("unrecognized message format, deleting message", {
        messageId: message.MessageId,
        bodyLength: message.Body?.length ?? 0,
      });
      await this.deleteMessage(message.ReceiptHandle);
      return null;
    }

    try {
      const result = await processMeetingAudio(this.pipelineDeps, parsed);
      await this.deleteMessage(message.ReceiptHandle);
      return result;
    } catch (err) {
      this.log.error("failed processing meeting audio in worker", {
        meetingId: parsed.meetingId,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  /**
   * Poll SQS once and process any available messages
   */
  async pollOnce(maxMessages = 1, waitTimeSeconds = 0): Promise<PipelineResult[]> {
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
      }),
    );

    const messages = response.Messages ?? [];
    const results: PipelineResult[] = [];

    for (const msg of messages) {
      try {
        const res = await this.processSingleMessage(msg);
        if (res) results.push(res);
      } catch {
        // Individual message failure: message will return to SQS after visibility timeout
      }
    }

    return results;
  }

  /**
   * Continuous polling loop
   */
  async startPolling(pollIntervalMs = 1000): Promise<void> {
    this.isPolling = true;
    this.log.info("SQS audio consumer loop started", { queueUrl: this.queueUrl });

    while (this.isPolling) {
      try {
        await this.pollOnce(5, 5); // 5s long-polling
      } catch (err) {
        this.log.error("error during SQS poll", { error: (err as Error).message });
      }

      if (this.isPolling) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }

  stop(): void {
    this.isPolling = false;
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
