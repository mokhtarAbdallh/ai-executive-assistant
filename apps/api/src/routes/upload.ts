import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type MeetingRepository,
  type ConsentRepository,
  type CreditRepository,
  MeetingStatus,
  type PrismaClient,
} from "@dawwen/db";

const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/aac",
] as const;

const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500 MB

const UploadUrlParamsSchema = z.object({
  id: z.string().min(1),
});

const UploadUrlBodySchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  contentType: z.enum(ALLOWED_AUDIO_CONTENT_TYPES),
  consentConfirmed: z.boolean().optional(),
});

export interface UploadRoutesOptions {
  meetingRepository: MeetingRepository;
  consentRepository: ConsentRepository;
  creditRepository?: CreditRepository;
  prisma: PrismaClient;
  s3Client?: S3Client;
  bucketName?: string;
}

export async function uploadRoutes(
  fastify: FastifyInstance,
  options: UploadRoutesOptions,
) {
  const { meetingRepository, consentRepository } = options;
  const bucketName =
    options.bucketName ||
    process.env.AUDIO_BUCKET_NAME ||
    "meeting-assistant-audio";

  const s3Client =
    options.s3Client ||
    new S3Client({
      region: process.env.AWS_REGION || "eu-central-1",
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: !!process.env.AWS_ENDPOINT_URL, // needed for LocalStack
    });

  fastify.post(
    "/meetings/:id/upload-url",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = UploadUrlParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: params.error.format(),
        });
      }

      const body = UploadUrlBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: body.error.format(),
        });
      }

      const user = request.user!;
      const meetingId = params.data.id;
      const { fileName, fileSizeBytes, contentType, consentConfirmed } = body.data;

      // 1. Verify meeting exists and belongs to this user
      const meeting = await meetingRepository.findById(
        { userId: user.id },
        meetingId,
      );
      if (!meeting) {
        return reply.status(404).send({ error: "Meeting not found" });
      }

      // 2. Consent Gate (Invariant 4)
      const hasExistingConsent = await consentRepository.hasConsent(
        { userId: user.id },
        meetingId,
      );

      if (!hasExistingConsent) {
        if (consentConfirmed) {
          // Record participant consent on-the-fly
          await consentRepository.createConsent(
            { userId: user.id },
            {
              meetingId,
              participantName: user.name || user.email,
              participantEmail: user.email,
              consentMethod: "ui_checkbox",
              ipAddress: request.ip,
              userAgent: request.headers["user-agent"],
            },
          );
        } else {
          return reply.status(400).send({
            error: "Consent required",
            message:
              "Recording consent must be confirmed before uploading audio. (Invariant 4: Consent Gate)",
          });
        }
      }

      // 3. Balance Gate before processing (Phase 6)
      if (options.creditRepository) {
        const balance = await options.creditRepository.getBalance({ userId: user.id });
        if (balance.availableMicros <= 0n) {
          return reply.status(402).send({
            error: "Insufficient credit balance",
            message:
              "You need a positive credit balance to upload and process meetings. Please top up your credits.",
            balanceMicros: balance.balanceMicros.toString(),
            availableMicros: balance.availableMicros.toString(),
          });
        }
      }

      // 4. Construct sanitized S3 Key (ADR-002: uploads/{userId}/{meetingId}/{filename})
      const sanitizedName = fileName
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_{2,}/g, "_");

      const s3Key = `uploads/${user.id}/${meetingId}/${sanitizedName}`;

      // 4. Generate Presigned PUT URL with exact ContentLength & ContentType (ADR-012)
      const putCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        ContentLength: fileSizeBytes,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, putCommand, {
        expiresIn: 900, // 15 minutes
      });

      // 5. Update meeting in DB with S3 Key and QUEUED status
      await options.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          audioS3Key: s3Key,
          status: MeetingStatus.QUEUED,
        },
      });

      return reply.send({
        uploadUrl,
        s3Key,
        expiresInSeconds: 900,
        meetingId,
      });
    },
  );
}
