import { Router } from "express";
import { prisma } from "../db/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let db: "up" | "down" = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }
  res.status(db === "up" ? 200 : 503).json({ status: db === "up" ? "ok" : "degraded", db });
});
