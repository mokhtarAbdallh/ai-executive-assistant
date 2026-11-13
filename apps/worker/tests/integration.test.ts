import { describe, it, expect, vi } from "vitest";
import { SqsAudioConsumer } from "../src/consumer.js";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";
import { MeetingStatus, ProposalStatus, ProposalActionType } from "@dawwen/db";
import { createMemoryPrisma, seedQueuedMeeting } from "./helpers/memory-prisma.js";

describe("LocalStack S3 → SQS → Worker → DB Integration Flow", () => {
  it("processes an S3 ObjectCreated event end-to-end and cleans up SQS and S3", async () => {
    const userId = "user-localstack-e2e";
    const meetingId = "meet-localstack-e2e";
    const bucketName = "dawwen-localstack-audio";
    const fileName = "strategy_session.mp3";
    const s3Key = `uploads/${userId}/${meetingId}/${fileName}`;

    const mockPrisma = createMemoryPrisma();
    seedQueuedMeeting(mockPrisma, { meetingId, userId, s3Key });
    const rows = (t: string) => mockPrisma.tables[t]!;

    // S3 mock simulating LocalStack S3 GetObject and DeleteObject
    let s3DeletedKey: string | null = null;
    const mockS3 = {
      send: vi.fn().mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === "GetObjectCommand") {
          return {
            Body: (async function* () {
              yield Buffer.from("simulated audio stream from LocalStack S3");
            })(),
          };
        }
        if (cmdName === "DeleteObjectCommand") {
          s3DeletedKey = command.input.Key;
          return {};
        }
        return {};
      }),
    };

    // SQS mock simulating LocalStack SQS queue with an incoming S3 Notification message
    const receiptHandle = "localstack-receipt-handle-101";
    const s3EventNotificationBody = JSON.stringify({
      Records: [
        {
          eventVersion: "2.1",
          eventSource: "aws:s3",
          eventName: "ObjectCreated:Put",
          s3: {
            bucket: { name: bucketName },
            object: {
              key: `uploads%2F${userId}%2F${meetingId}%2F${fileName}`,
            },
          },
        },
      ],
    });

    let messageDeletedFromQueue = false;
    const mockSqs = {
      send: vi.fn().mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === "ReceiveMessageCommand") {
          return {
            Messages: [
              {
                MessageId: "msg-101",
                ReceiptHandle: receiptHandle,
                Body: s3EventNotificationBody,
              },
            ],
          };
        }
        if (cmdName === "DeleteMessageCommand") {
          if (command.input.ReceiptHandle === receiptHandle) {
            messageDeletedFromQueue = true;
          }
          return {};
        }
        return {};
      }),
    };

    const consumer = new SqsAudioConsumer(
      mockSqs as any,
      "http://localhost:4566/000000000000/dawwen-audio-queue",
      {
        prisma: mockPrisma as never,
        s3Client: mockS3 as any,
        asrClient: new FakeSpeechToText(),
        llmClient: new FakeLlmClient(),
        pricingConfig: {
          customerPricePerAudioMinuteMicros: 20000,
          providerCosts: {
            asrPerAudioMinuteMicros: { fake: 0 },
            llmPerMillionInputTokensMicros: { fake: 0 },
            llmPerMillionOutputTokensMicros: { fake: 0 },
            embeddingsPerMillionTokensMicros: { fake: 0 },
          },
          lowBalanceThresholdMicros: 1000000,
        },
        asrProviderName: "fake",
        llmProviderName: "fake",
      },
    );

    // Act: Poll and process single message through consumer
    const results = await consumer.pollOnce(1, 0);

    // Assert: S3 → SQS → Worker → DB flow completed
    expect(results.length).toBe(1);
    const result = results[0];
    expect(result).toBeDefined();
    expect(result!.meetingId).toBe(meetingId);
    expect(result!.segmentsCount).toBeGreaterThan(0);
    expect(result!.decisionsCount).toBeGreaterThan(0);
    expect(result!.tasksCount).toBeGreaterThan(0);

    // 1. Database state verified
    expect(rows("meeting")[0]!.status).toBe(MeetingStatus.REVIEW_PENDING);
    expect(rows("transcriptSegment").length).toBeGreaterThan(0);
    expect(rows("decision").length).toBeGreaterThan(0);
    expect(rows("task").length).toBeGreaterThan(0);
    expect(rows("usageEvent").length).toBe(2); // ASR + LLM

    // 2. Proposal created with PENDING_APPROVAL
    expect(rows("proposal").length).toBe(1);
    expect(rows("proposal")[0]!.status).toBe(ProposalStatus.PENDING_APPROVAL);
    expect(rows("proposal")[0]!.actionType).toBe(ProposalActionType.SCHEDULE_MEETING);

    // 3. Raw audio deleted from S3 (Invariant 5)
    expect(s3DeletedKey).toBe(s3Key);
    expect(rows("meeting")[0]!.audioDeletedAt).toBeInstanceOf(Date);

    // 4. Message acknowledged and deleted from SQS queue
    expect(messageDeletedFromQueue).toBe(true);
  });
});
