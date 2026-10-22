import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Role } from "@dawwen/db";
import type { AuthenticatedUser, IAuthProvider } from "./types.js";

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId?: string;
  jwksUrl?: string;
}

export class CognitoAuthProvider implements IAuthProvider {
  public readonly providerName = "cognito" as const;
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;

  constructor(private readonly config: CognitoConfig) {
    this.issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
    const jwksUri =
      config.jwksUrl ||
      `${this.issuer}/.well-known/jwks.json`;

    this.jwks = createRemoteJWKSet(new URL(jwksUri));
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.config.clientId,
      });

      if (!payload.sub) {
        throw new Error("Missing subject claim in Cognito token");
      }

      const email =
        (payload.email as string) ||
        (payload["cognito:username"] as string) ||
        `${payload.sub}@cognito.user`;

      const name = (payload.name as string) || (payload.given_name as string) || email;
      const groups = (payload["cognito:groups"] as string[]) || [];
      const role = groups.includes("admin") ? Role.OWNER : Role.MEMBER;

      return {
        id: payload.sub,
        email,
        name,
        role,
      };
    } catch {
      throw new Error("Unauthorized: Invalid AWS Cognito token signature or expired");
    }
  }
}
