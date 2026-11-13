import { describe, expect, it } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "../src/services/s3.js";

/** ADR-025: presigned uploads must not carry a checksum of an empty body. */
describe("presigned audio upload URL", () => {
  const command = new PutObjectCommand({
    Bucket: "meeting-assistant-audio",
    Key: "uploads/u1/m1/a.wav",
    ContentType: "audio/wav",
  });
  const credentials = { accessKeyId: "test", secretAccessKey: "test" };

  it("has no x-amz-checksum / sdk-checksum parameters", async () => {
    const client = createS3Client();
    client.config.credentials = async () => credentials;
    const url = new URL(await getSignedUrl(client, command, { expiresIn: 60 }));

    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(params.some((k) => k.startsWith("x-amz-checksum"))).toBe(false);
    expect(params).not.toContain("x-amz-sdk-checksum-algorithm");
  });

  it("documents the SDK default this guards against", async () => {
    const plain = new S3Client({ region: "eu-central-1", credentials });
    const url = new URL(await getSignedUrl(plain, command, { expiresIn: 60 }));
    // If a future SDK stops adding it by default, this test can go.
    expect([...url.searchParams.keys()].join(",")).toMatch(/x-amz-checksum-crc32/i);
  });
});
