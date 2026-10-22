export interface DatabaseUrlParts {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  /** Require TLS (Aurora in production). */
  ssl: boolean;
}

/**
 * Terraform injects DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD separately, but Prisma needs a
 * single connection URL. Credentials are URL-encoded because managed passwords may contain
 * reserved characters (`@`, `/`, `:`...).
 */
export function buildDatabaseUrl(parts: DatabaseUrlParts): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  const name = encodeURIComponent(parts.name);
  const params = new URLSearchParams({ schema: "public" });
  if (parts.ssl) params.set("sslmode", "require");
  return `postgresql://${user}:${password}@${parts.host}:${parts.port}/${name}?${params.toString()}`;
}
