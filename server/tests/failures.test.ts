import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { Prisma } from "../src/generated/prisma/client.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { cache, redis } from "../src/lib/redis.js";
import { createApp } from "../src/app.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("database unavailable", () => {
  it("maps connection errors to 503 SERVICE_UNAVAILABLE", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Prisma.PrismaClientKnownRequestError("connect ECONNREFUSED", {
        code: "ECONNREFUSED",
        clientVersion: "test",
      });
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("redis unavailable", () => {
  it("cache helpers fail open instead of throwing", async () => {
    vi.spyOn(redis, "get").mockRejectedValue(new Error("Connection is closed."));
    vi.spyOn(redis, "set").mockRejectedValue(new Error("Connection is closed."));
    vi.spyOn(redis, "incr").mockRejectedValue(new Error("Connection is closed."));

    await expect(cache.getJson("k", z.object({ a: z.number() }))).resolves.toBeNull();
    await expect(cache.get("k")).resolves.toBeNull();
    await expect(cache.setJson("k", { a: 1 }, 10)).resolves.toBeUndefined();
    await expect(cache.incr("k")).resolves.toBeUndefined();
  });

  it("treats a cached value that fails schema validation as a miss", async () => {
    vi.spyOn(redis, "get").mockResolvedValue(JSON.stringify({ a: "not-a-number" }));

    await expect(cache.getJson("k", z.object({ a: z.number() }))).resolves.toBeNull();
  });

  it("health reports degraded (200) when only Redis is down", async () => {
    vi.spyOn(redis, "ping").mockRejectedValue(new Error("Connection is closed."));

    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "degraded", db: "up", redis: "down" });
  });
});
