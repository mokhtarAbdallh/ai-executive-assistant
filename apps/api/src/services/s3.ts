import { S3Client } from "@aws-sdk/client-s3";

/**
 * The API's S3 client (ADR-017, ADR-025).
 *
 * `requestChecksumCalculation: "WHEN_REQUIRED"`: since SDK 3.729 the default
 * ("WHEN_SUPPORTED") signs a CRC32 checksum of the EMPTY body into presigned PutObject
 * URLs, so every browser upload of real audio is rejected by S3 ("Value for
 * x-amz-checksum-crc32 header is invalid"). Uploads are presigned, so the checksum
 * must only be added when an operation requires it.
 */
export function createS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION || "eu-central-1",
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: !!process.env.AWS_ENDPOINT_URL, // needed for LocalStack
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
