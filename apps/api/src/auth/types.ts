import type { Role } from "@dawwen/db";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface IAuthProvider {
  readonly providerName: "local" | "cognito";
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
}
