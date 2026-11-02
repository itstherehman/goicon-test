import { Redis } from "ioredis";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Redis is a cache only, so every command is fail-fast: no offline queue,
 * short timeouts, and callers go through `cache` which never throws.
 */
export const redis = new Redis(env.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  commandTimeout: 500,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
});

// Log connection state changes once, not on every reconnect attempt.
let reportedDown = false;
redis.on("error", (err) => {
  if (reportedDown) return;
  reportedDown = true;
  logger.warn({ err: { message: err.message } }, "redis unavailable");
});
redis.on("ready", () => {
  if (reportedDown) logger.info("redis reconnected");
  reportedDown = false;
});

/** Resolves once Redis is ready, or false after `timeoutMs`. */
export function waitForRedis(timeoutMs = 2000): Promise<boolean> {
  if (redis.status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      resolve(false);
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    redis.once("ready", onReady);
  });
}

function warn(op: string, key: string, err: unknown) {
  logger.warn({ op, key, err: { message: err instanceof Error ? err.message : String(err) } }, "redis command failed");
}

/**
 * Fail-open cache helpers: on any Redis error they log and behave like a miss,
 * so the caller falls back to the database.
 */
export const cache = {
  async getJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await redis.get(key);
      if (raw === null) return null;
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch (err) {
      warn("get", key, err);
      return null;
    }
  },

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      warn("set", key, err);
    }
  },

  async get(key: string): Promise<string | null> {
    try {
      return await redis.get(key);
    } catch (err) {
      warn("get", key, err);
      return null;
    }
  },

  async incr(key: string): Promise<void> {
    try {
      await redis.incr(key);
    } catch (err) {
      warn("incr", key, err);
    }
  },
};
