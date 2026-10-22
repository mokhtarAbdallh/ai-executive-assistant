import crypto from "node:crypto";

export interface KeyProvider {
  getKey(): Promise<Buffer> | Buffer;
}

export class HkdfKeyProvider implements KeyProvider {
  private cachedKey: Buffer | null = null;

  constructor(
    private readonly appSecret: string,
    private readonly salt: string = "dawwen-token-salt-v1",
    private readonly info: string = "dawwen-google-tokens-v1",
  ) {
    if (!appSecret || appSecret.length < 32) {
      throw new Error("appSecret must be at least 32 characters for HKDF key derivation");
    }
  }

  getKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    const key = crypto.hkdfSync(
      "sha256",
      Buffer.from(this.appSecret, "utf-8"),
      Buffer.from(this.salt, "utf-8"),
      Buffer.from(this.info, "utf-8"),
      32,
    );

    this.cachedKey = Buffer.from(key);
    return this.cachedKey;
  }
}

export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
}

export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptionError";
  }
}

export class TokenEncryptor {
  constructor(private readonly keyProvider: KeyProvider) {}

  async encrypt(data: unknown): Promise<string> {
    const key = await this.keyProvider.getKey();
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const plaintext = Buffer.from(JSON.stringify(data), "utf-8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    // Format: iv:authTag:ciphertext (base64 encoded)
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  async decrypt<T = GoogleOAuthTokens>(encryptedString: string): Promise<T> {
    const parts = encryptedString.split(":");
    if (parts.length !== 3) {
      throw new TokenDecryptionError("Invalid encrypted token format: expected 3 colon-separated components");
    }

    const [ivB64, authTagB64, ciphertextB64] = parts;
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new TokenDecryptionError("Invalid encrypted token format: empty components");
    }

    try {
      const iv = Buffer.from(ivB64, "base64");
      const authTag = Buffer.from(authTagB64, "base64");
      const ciphertext = Buffer.from(ciphertextB64, "base64");

      if (iv.length !== 12) {
        throw new TokenDecryptionError("Invalid IV length for AES-GCM");
      }
      if (authTag.length !== 16) {
        throw new TokenDecryptionError("Invalid auth tag length for AES-GCM");
      }

      const key = await this.keyProvider.getKey();
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString("utf-8")) as T;
    } catch (err) {
      if (err instanceof TokenDecryptionError) {
        throw err;
      }
      throw new TokenDecryptionError(
        `Failed to decrypt token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
