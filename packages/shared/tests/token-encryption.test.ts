import { describe, it, expect } from "vitest";
import {
  HkdfKeyProvider,
  TokenEncryptor,
  TokenDecryptionError,
  type GoogleOAuthTokens,
  type KeyProvider,
} from "../src/crypto/token-encryption.js";

const VALID_SECRET = "super-secret-passphrase-at-least-32-chars-long";

describe("Token Encryption & Security (ADR-007)", () => {
  it("rejects secrets shorter than 32 characters", () => {
    expect(() => new HkdfKeyProvider("short-secret")).toThrowError(
      "appSecret must be at least 32 characters",
    );
  });

  it("derives deterministic 32-byte key from app secret", () => {
    const provider1 = new HkdfKeyProvider(VALID_SECRET);
    const provider2 = new HkdfKeyProvider(VALID_SECRET);

    const key1 = provider1.getKey();
    const key2 = provider2.getKey();

    expect(key1).toHaveLength(32);
    expect(key1).toEqual(key2);
  });

  it("encrypts and decrypts Google OAuth tokens correctly", async () => {
    const provider = new HkdfKeyProvider(VALID_SECRET);
    const encryptor = new TokenEncryptor(provider);

    const tokens: GoogleOAuthTokens = {
      accessToken: "ya29.a0AfH6SM...",
      refreshToken: "1//04e9AbCdEfGhIjKlMnOpQrStUvWxYz",
      idToken: "eyJhbGciOiJSUzI1NiIs...",
      expiryDate: 1729600000000,
      scope: "https://www.googleapis.com/auth/calendar.events",
      tokenType: "Bearer",
    };

    const encrypted = await encryptor.encrypt(tokens);
    expect(typeof encrypted).toBe("string");
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = await encryptor.decrypt<GoogleOAuthTokens>(encrypted);
    expect(decrypted).toEqual(tokens);
  });

  it("uses random IV so identical data produces different ciphertexts", async () => {
    const provider = new HkdfKeyProvider(VALID_SECRET);
    const encryptor = new TokenEncryptor(provider);

    const tokens: GoogleOAuthTokens = { accessToken: "test-token-123" };

    const enc1 = await encryptor.encrypt(tokens);
    const enc2 = await encryptor.encrypt(tokens);

    expect(enc1).not.toBe(enc2);

    const dec1 = await encryptor.decrypt<GoogleOAuthTokens>(enc1);
    const dec2 = await encryptor.decrypt<GoogleOAuthTokens>(enc2);

    expect(dec1).toEqual(tokens);
    expect(dec2).toEqual(tokens);
  });

  it("detects ciphertext tampering and throws TokenDecryptionError", async () => {
    const provider = new HkdfKeyProvider(VALID_SECRET);
    const encryptor = new TokenEncryptor(provider);

    const tokens = { accessToken: "real-token" };
    const encrypted = await encryptor.encrypt(tokens);

    const [iv, tag, ciphertext] = encrypted.split(":");

    // Flip a bit in ciphertext
    const tamperedBuf = Buffer.from(ciphertext!, "base64");
    tamperedBuf[0] = (tamperedBuf[0]! ^ 0xff);
    const tamperedEncrypted = `${iv}:${tag}:${tamperedBuf.toString("base64")}`;

    await expect(encryptor.decrypt(tamperedEncrypted)).rejects.toThrow(
      TokenDecryptionError,
    );
  });

  it("detects authentication tag tampering", async () => {
    const provider = new HkdfKeyProvider(VALID_SECRET);
    const encryptor = new TokenEncryptor(provider);

    const tokens = { accessToken: "real-token" };
    const encrypted = await encryptor.encrypt(tokens);

    const [iv, tag, ciphertext] = encrypted.split(":");

    // Tamper with tag
    const tamperedTag = Buffer.from(tag!, "base64");
    tamperedTag[0] = (tamperedTag[0]! ^ 0x01);
    const tamperedEncrypted = `${iv}:${tamperedTag.toString("base64")}:${ciphertext}`;

    await expect(encryptor.decrypt(tamperedEncrypted)).rejects.toThrow(
      TokenDecryptionError,
    );
  });

  it("fails when decrypted with a different secret", async () => {
    const provider1 = new HkdfKeyProvider(VALID_SECRET);
    const provider2 = new HkdfKeyProvider("another-secret-key-that-is-32-bytes-long!!");

    const encryptor1 = new TokenEncryptor(provider1);
    const encryptor2 = new TokenEncryptor(provider2);

    const encrypted = await encryptor1.encrypt({ secretData: "confidential" });

    await expect(encryptor2.decrypt(encrypted)).rejects.toThrow(
      TokenDecryptionError,
    );
  });

  it("supports custom KeyProvider interface (e.g. AWS KMS)", async () => {
    const staticKey = Buffer.alloc(32, 7); // 32 bytes of 0x07
    const kmsMockProvider: KeyProvider = {
      getKey: async () => staticKey,
    };

    const encryptor = new TokenEncryptor(kmsMockProvider);
    const encrypted = await encryptor.encrypt({ kmsKey: true });
    const decrypted = await encryptor.decrypt<{ kmsKey: boolean }>(encrypted);

    expect(decrypted).toEqual({ kmsKey: true });
  });
});
