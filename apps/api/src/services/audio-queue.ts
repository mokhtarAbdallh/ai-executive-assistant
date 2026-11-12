import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

/** Message the worker consumes (same shape as `parseSqsMessage` direct JSON). */
export interface AudioJob {
  meetingId: string;
  userId: string;
  s3Bucket: string;
  s3Key: string;
}

export interface AudioQueue {
  enqueue(job: AudioJob): Promise<void>;
}

/** Sends a processing job to the audio SQS queue (used for retries, ADR-023). */
export class SqsAudioQueue implements AudioQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  static fromEnv(): SqsAudioQueue | undefined {
    const queueUrl = process.env.AUDIO_QUEUE_URL;
    if (!queueUrl) return undefined;
    return new SqsAudioQueue(
      new SQSClient({
        region: process.env.AWS_REGION || "eu-central-1",
        endpoint: process.env.AWS_ENDPOINT_URL,
      }),
      queueUrl,
    );
  }

  async enqueue(job: AudioJob): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(job) }),
    );
  }
}
