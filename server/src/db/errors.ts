import { Prisma } from "../generated/prisma/client.js";

// Driver-level network errors surface as the Prisma error `code` with the pg adapter.
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "P1001", // can't reach database server
  "P1002", // database server timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool
]);

export function isDbUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return UNAVAILABLE_CODES.has(err.code);
  return false;
}

export function isPrismaError(err: unknown): err is Error & { code?: string } {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}
