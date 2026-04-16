import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

// SQLite URL resolution differs across Prisma entry points:
//   - Prisma CLI via prisma.config.ts resolves `file:./dev.db` relative to
//     the schema file (prisma/dev.db).
//   - The generated client loaded at Next.js runtime resolves the same URL
//     relative to the process cwd (project-root/dev.db — doesn't exist).
// Constructing an absolute path from cwd + ./prisma/dev.db resolves both to
// the same file regardless of caller.
const dbPath = path.resolve(process.cwd(), "prisma/dev.db");
const url = `file:${dbPath}`;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasources: { db: { url } } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
