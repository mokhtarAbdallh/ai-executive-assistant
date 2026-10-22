import { describe, it, expect, vi } from "vitest";
import { SqsAudioConsumer } from "../src/consumer.js";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";
import {
  MeetingStatus,
  ProposalStatus,
  ProposalActionType,
} from "@dawwen/db";

describe("LocalStack S3 → SQS → Worker → DB Integration Flow", () => {
  it("processes an S3 ObjectCreated event end-to-end and cleans up SQS and S3", async () => {
    const userId = "user-localstack-e2e";
    const meetingId = "meet-localstack-e2e";
    const bucketName = "dawwen-localstack-audio";
    const fileName = "strategy_session.mp3";
    const s3Key = `uploads/${userId}/${meetingId}/${fileName}`;

    // Database state tracking
    let meetingStatus = MeetingStatus.QUEUED;
    let audioDeletedAt: Date | null = null;
    const insertedSegments: any[] = [];
    const insertedDecisions: any[] = [];
    const insertedTasks: any[] = [];
    const insertedProposals: any[] = [];
    const insertedUsageEvents: any[] = [];

    const mockPrisma = {
      meeting: {
        findUnique: vi.fn().mockImplementation(() =>
          Promise.resolve({
            id: meetingId,
            userId,
            title: "LocalStack Strategy Session",
            status: meetingStatus,
            language: "ar",
            audioS3Key: s3Key,
            audioDurationSeconds: null,
            audioDeletedAt,
          }),
        ),
        update: vi.fn().mockImplementation(({ data }: { data: any }) => {
          if (data.status) meetingStatus = data.status;
          if (data.audioDeletedAt) audioDeletedAt = data.audioDeletedAt;
          return Promise.resolve({ id: meetingId, status: meetingStatus });
        }),
      },
      userSettings: {
        findUnique: vi.fn().mockResolvedValue({
          userId,
          audioRetentionDays: 0, // Invariant 5: immediate deletion
        }),
      },
      recordingConsent: {
        findFirst: vi.fn().mockResolvedValue({
          id: "consent-e2e",
          userId,
          meetingId,
          participantName: "E2E Participant",
        }),
      },
      transcriptSegment: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `seg-${insertedSegments.length + 1}`, ...data };
          insertedSegments.push(item);
          return Promise.resolve(item);
        }),
      },
      meetingAnalysis: {
        upsert: vi.fn().mockResolvedValue({ id: "analysis-e2e" }),
      },
      agendaItem: {
        create: vi.fn().mockResolvedValue({ id: "agenda-e2e" }),
      },
      topicDiscussion: {
        create: vi.fn().mockResolvedValue({ id: "topic-e2e" }),
      },
      decision: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `dec-${insertedDecisions.length + 1}`, ...data };
          insertedDecisions.push(item);
          return Promise.resolve(item);
        }),
      },
      task: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `task-${insertedTasks.length + 1}`, ...data };
          insertedTasks.push(item);
          return Promise.resolve(item);
        }),
      },
      openQuestion: {
        create: vi.fn().mockResolvedValue({ id: "q-e2e" }),
      },
      documentReference: {
        create: vi.fn().mockResolvedValue({ id: "doc-e2e" }),
      },
      proposal: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `prop-${insertedProposals.length + 1}`, ...data };
          insertedProposals.push(item);
          return Promise.resolve(item);
        }),
      },
      usageEvent: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `usage-${insertedUsageEvents.length + 1}`, ...data };
          insertedUsageEvents.push(item);
          return Promise.resolve(item);
        }),
      },
    };

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
        prisma: mockPrisma as any,
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
    expect(meetingStatus).toBe(MeetingStatus.REVIEW_PENDING);
    expect(insertedSegments.length).toBeGreaterThan(0);
    expect(insertedDecisions.length).toBeGreaterThan(0);
    expect(insertedTasks.length).toBeGreaterThan(0);
    expect(insertedUsageEvents.length).toBe(2); // ASR + LLM

    // 2. Proposal created with PENDING_APPROVAL
    expect(insertedProposals.length).toBe(1);
    expect(insertedProposals[0].status).toBe(ProposalStatus.PENDING_APPROVAL);
    expect(insertedProposals[0].actionType).toBe(ProposalActionType.SCHEDULE_MEETING);

    // 3. Raw audio deleted from S3 (Invariant 5)
    expect(s3DeletedKey).toBe(s3Key);
    expect(audioDeletedAt).toBeInstanceOf(Date);

    // 4. Message acknowledged and deleted from SQS queue
    expect(messageDeletedFromQueue).toBe(true);
  });
});
