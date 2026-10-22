import { describe, it, expect, vi } from "vitest";
import { parseSqsMessage, SqsAudioConsumer } from "../src/consumer.js";
import { DeleteMessageCommand } from "@aws-sdk/client-sqs";

describe("SQS Audio Consumer (@dawwen/worker)", () => {
  describe("parseSqsMessage", () => {
    it("parses direct JSON message format", () => {
      const payload = JSON.stringify({
        meetingId: "meet-123",
        userId: "user-456",
        s3Bucket: "my-bucket",
        s3Key: "uploads/user-456/meet-123/recording.mp3",
      });

      const parsed = parseSqsMessage(payload);
      expect(parsed).toEqual({
        meetingId: "meet-123",
        userId: "user-456",
        s3Bucket: "my-bucket",
        s3Key: "uploads/user-456/meet-123/recording.mp3",
      });
    });

    it("parses and URL-decodes S3 Event Notification format", () => {
      const s3Event = JSON.stringify({
        Records: [
          {
            eventVersion: "2.1",
            eventSource: "aws:s3",
            eventName: "ObjectCreated:Put",
            s3: {
              bucket: { name: "dawwen-audio-bucket" },
              object: {
                key: "uploads%2Fuser_789%2Fmeet_abc%2Fmy+meeting+recording.mp3",
              },
            },
          },
        ],
      });

      const parsed = parseSqsMessage(s3Event);
      expect(parsed).toEqual({
        meetingId: "meet_abc",
        userId: "user_789",
        s3Bucket: "dawwen-audio-bucket",
        s3Key: "uploads/user_789/meet_abc/my meeting recording.mp3",
      });
    });

    it("recognizes and flags s3:TestEvent", () => {
      const testEvent = JSON.stringify({
        Service: "Amazon S3",
        Event: "s3:TestEvent",
        Time: "2026-10-22T00:00:00.000Z",
        Bucket: "dawwen-audio-bucket",
      });

      expect(parseSqsMessage(testEvent)).toBe("TEST_EVENT");
    });

    it("returns null for malformed or unrecognized JSON", () => {
      expect(parseSqsMessage("not-json")).toBeNull();
      expect(parseSqsMessage(JSON.stringify({ random: "data" }))).toBeNull();
      expect(
        parseSqsMessage(
          JSON.stringify({
            Records: [
              {
                s3: {
                  bucket: { name: "b" },
                  object: { key: "other-folder/file.mp3" },
                },
              },
            ],
          }),
        ),
      ).toBeNull();
    });
  });

  describe("SqsAudioConsumer processing loop", () => {
    it("deletes s3:TestEvent message immediately without triggering pipeline", async () => {
      const mockSqs = {
        send: vi.fn().mockResolvedValue({}),
      };

      const mockDeps: any = {};
      const consumer = new SqsAudioConsumer(mockSqs as any, "https://sqs.mock/queue", mockDeps);

      const testMsg = {
        Body: JSON.stringify({ Event: "s3:TestEvent" }),
        ReceiptHandle: "receipt-handle-test",
      };

      const result = await consumer.processSingleMessage(testMsg);
      expect(result).toBeNull();
      expect(mockSqs.send).toHaveBeenCalledTimes(1);
      const deleteCmd = mockSqs.send.mock.calls[0]?.[0];
      expect(deleteCmd).toBeInstanceOf(DeleteMessageCommand);
      expect(deleteCmd.input.ReceiptHandle).toBe("receipt-handle-test");
    });
  });
});
