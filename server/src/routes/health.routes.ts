import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../lib/redis.js";

export const healthRouter = Router();

async function check(probe: () => Promise<unknown>): Promise<"up" | "down"> {
  try {
    await probe();
    return "up";
  } catch {
    return "down";
  }
}

// DB down → 503 (the API can't serve). Redis down → 200 "degraded" (cache is optional).
healthRouter.get("/", async (_req, res) => {
  const [db, cache] = await Promise.all([check(() => prisma.$queryRaw`SELECT 1`), check(() => redis.ping())]);
  const status = db === "down" ? "down" : cache === "down" ? "degraded" : "ok";
  res.status(db === "up" ? 200 : 503).json({ status, db, redis: cache });
});
