import type { Role } from "@prisma/client";

export class CrossTenantAccessViolationError extends Error {
  constructor(
    public readonly requestedId: string,
    public readonly tenantUserId: string,
    entityName = "Entity",
  ) {
    super(
      `Cross-tenant access violation: User '${tenantUserId}' is not authorized to access or modify ${entityName} '${requestedId}'.`,
    );
    this.name = "CrossTenantAccessViolationError";
  }
}

export interface TenantContext {
  userId: string;
  role?: Role;
}
