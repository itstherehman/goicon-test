import { afterAll, beforeAll } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { redis, waitForRedis } from "../src/lib/redis.js";

beforeAll(async () => {
  await waitForRedis();
});

afterAll(async () => {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});
