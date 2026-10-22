import { PrismaClient } from "@prisma/client";

declare global {
  var __dawwen_prisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return new PrismaClient();
  }
  if (!global.__dawwen_prisma) {
    global.__dawwen_prisma = new PrismaClient({
      log: ["warn", "error"],
    });
  }
  return global.__dawwen_prisma;
}

export const prisma = getPrismaClient();
export * from "@prisma/client";
