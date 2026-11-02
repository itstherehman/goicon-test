import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { EventType } from "../src/generated/prisma/client.js";
import { redis } from "../src/lib/redis.js";
import { analyticsVersionKey } from "../src/modules/analytics/analytics.cache-keys.js";
import { createTestOrg, deleteTestOrgs, insertEvents, type TestOrg } from "./helpers/fixtures.js";

const app = createApp();
let acme: TestOrg;
let globex: TestOrg;
let empty: TestOrg;

const RANGE = { from: "2026-10-01", to: "2026-10-05" };

beforeAll(async () => {
  [acme, globex, empty] = await Promise.all([createTestOrg("Acme"), createTestOrg("Globex"), createTestOrg("Empty")]);

  await insertEvents(acme.org.id, [
    // Outside the range on both sides: must not be counted.
    { occurredAt: "2026-09-30T23:59:59.999Z", eventType: EventType.job_completed },
    { occurredAt: "2026-10-06T00:00:00.000Z", eventType: EventType.job_completed },
    // Range edges: first and last instant of the inclusive day range.
    { occurredAt: "2026-10-01T00:00:00.000Z", eventType: EventType.job_completed, source: "scheduler" },
    { occurredAt: "2026-10-05T23:59:59.999Z", eventType: EventType.payment_failed, source: "billing-service" },
    // Local time on Oct 2 but Oct 3 in UTC: bucketed by UTC day.
    { occurredAt: "2026-10-02T23:30:00-02:00", eventType: EventType.job_completed, source: "scheduler" },
    { occurredAt: "2026-10-03T12:00:00Z", eventType: EventType.job_completed, source: "billing-service" },
    { occurredAt: "2026-10-03T13:00:00Z", eventType: EventType.payment_failed, source: "billing-service" },
  ]);

  await insertEvents(globex.org.id, [{ occurredAt: "2026-10-02T10:00:00Z", eventType: EventType.user_invited, source: "web-app" }]);
});

afterAll(async () => {
  await deleteTestOrgs(acme, globex, empty);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const summary = (token: string, query: Record<string, string> = {}) =>
  request(app).get("/api/analytics/summary").query(query).set("Authorization", `Bearer ${token}`);

describe("GET /api/analytics/summary: auth", () => {
  it("returns 401 without a token", async () => {
    expect((await request(app).get("/api/analytics/summary")).status).toBe(401);
  });

  it("lets both Admin and Analyst read", async () => {
    expect((await summary(acme.adminToken, RANGE)).status).toBe(200);
    expect((await summary(acme.analystToken, RANGE)).status).toBe(200);
  });
});

describe("GET /api/analytics/summary: aggregation", () => {
  it("returns totals, counts by type and a zero-filled UTC daily trend", async () => {
    const res = await summary(acme.analystToken, RANGE);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      range: { from: "2026-10-01", to: "2026-10-05", timezone: "UTC" },
      filters: { eventType: null, source: null },
      total: 5,
      byType: [
        { eventType: "job_completed", count: 3 },
        { eventType: "payment_failed", count: 2 },
      ],
      daily: [
        { date: "2026-10-01", count: 1 },
        { date: "2026-10-02", count: 0 },
        { date: "2026-10-03", count: 3 },
        { date: "2026-10-04", count: 0 },
        { date: "2026-10-05", count: 1 },
      ],
    });
  });

  it("applies eventType and source filters to every section", async () => {
    const byType = await summary(acme.analystToken, { ...RANGE, eventType: "payment_failed" });
    const bySource = await summary(acme.analystToken, { ...RANGE, source: "scheduler" });

    expect(byType.body.data.total).toBe(2);
    expect(byType.body.data.byType).toEqual([{ eventType: "payment_failed", count: 2 }]);
    expect(byType.body.data.daily.map((d: { count: number }) => d.count)).toEqual([0, 0, 1, 0, 1]);

    expect(bySource.body.data.total).toBe(2);
    expect(bySource.body.data.filters).toEqual({ eventType: null, source: "scheduler" });
  });

  it("keeps total, byType and daily consistent", async () => {
    const { data } = (await summary(acme.analystToken, { from: "2026-09-01", to: "2026-10-31" })).body;
    const sum = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);

    expect(data.total).toBe(7);
    expect(sum(data.byType)).toBe(data.total);
    expect(sum(data.daily)).toBe(data.total);
    expect(data.daily).toHaveLength(61);
  });

  it("returns zeros (not an error) for an org with no events", async () => {
    const res = await summary(empty.analystToken, RANGE);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.byType).toEqual([]);
    expect(res.body.data.daily).toHaveLength(5);
    expect(res.body.data.daily.every((d: { count: number }) => d.count === 0)).toBe(true);
  });

  it("defaults to the last 30 UTC days ending today", async () => {
    const res = await summary(empty.analystToken);
    const today = new Date().toISOString().slice(0, 10);

    expect(res.body.data.range.to).toBe(today);
    expect(res.body.data.daily).toHaveLength(30);
    expect(res.body.data.daily.at(-1).date).toBe(today);
  });

  it("supports a single-day range", async () => {
    const res = await summary(acme.analystToken, { from: "2026-10-03", to: "2026-10-03" });
    expect(res.body.data.daily).toEqual([{ date: "2026-10-03", count: 3 }]);
  });
});

describe("GET /api/analytics/summary: validation", () => {
  it.each([
    ["malformed from", { from: "10/01/2026" }, "from"],
    ["impossible date", { from: "2026-02-30" }, "from"],
    ["datetime instead of date", { to: "2026-10-05T00:00:00Z" }, "to"],
    ["from after to", { from: "2026-10-05", to: "2026-10-01" }, "to"],
    ["range over 366 days", { from: "2025-01-01", to: "2026-01-02" }, "from"],
    ["unsupported eventType", { eventType: "nope" }, "eventType"],
    ["orgId parameter", { orgId: "anything" }, ""],
  ])("returns 400 for %s", async (_label, query, path) => {
    const res = await summary(acme.analystToken, query);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ location: "query", path })]));
  });
});

describe("GET /api/analytics/summary: caching", () => {
  it("serves the second identical request from Redis", async () => {
    const query = { from: "2026-10-02", to: "2026-10-04" };

    const first = await summary(acme.analystToken, query);
    const second = await summary(acme.analystToken, query);

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body).toEqual(first.body);
  });

  it("never serves one org's cached result to another org with identical filters", async () => {
    const query = { from: "2026-10-01", to: "2026-10-03" };

    const acmeWarm = await summary(acme.analystToken, query);
    const acmeHit = await summary(acme.analystToken, query);
    const globexRes = await summary(globex.analystToken, query);

    expect(acmeHit.headers["x-cache"]).toBe("HIT");
    expect(globexRes.headers["x-cache"]).toBe("MISS");
    expect(globexRes.body.data.total).toBe(1);
    expect(globexRes.body.data.byType).toEqual([{ eventType: "user_invited", count: 1 }]);
    expect(acmeWarm.body.data.total).not.toBe(globexRes.body.data.total);

    const keys = await redis.keys(`analytics:v1:summary:org=${globex.org.id}:*`);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("uses a separate entry for every filter dimension", async () => {
    const base = { from: "2026-09-20", to: "2026-10-04" };
    await summary(acme.analystToken, base);

    for (const variant of [
      { ...base, to: "2026-10-05" },
      { ...base, from: "2026-09-21" },
      { ...base, eventType: "job_completed" },
      { ...base, source: "scheduler" },
    ]) {
      const res = await summary(acme.analystToken, variant);
      expect(res.headers["x-cache"]).toBe("MISS");
    }
  });

  it("reflects newly ingested events immediately (version bump), not after the TTL", async () => {
    const tmp = await createTestOrg("Tmp");
    const query = { from: "2026-10-01", to: "2026-10-31" };

    await summary(tmp.analystToken, query);
    expect((await summary(tmp.analystToken, query)).headers["x-cache"]).toBe("HIT");

    const ingest = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${tmp.adminToken}`)
      .send({ eventType: "job_failed", occurredAt: "2026-10-10T08:00:00Z", source: "scheduler", metadata: {} });
    expect(ingest.status).toBe(201);

    const after = await summary(tmp.analystToken, query);
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.data.total).toBe(1);
    await deleteTestOrgs(tmp);
  });

  it("ingest in one org does not invalidate another org's cache", async () => {
    const query = { from: "2026-10-01", to: "2026-10-02" };
    await summary(globex.analystToken, query);
    const versionBefore = await redis.get(analyticsVersionKey(globex.org.id));

    await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${acme.adminToken}`)
      .send({ eventType: "job_failed", occurredAt: "2026-08-01T08:00:00Z", source: "scheduler", metadata: {} });

    expect(await redis.get(analyticsVersionKey(globex.org.id))).toBe(versionBefore);
    expect((await summary(globex.analystToken, query)).headers["x-cache"]).toBe("HIT");
  });

  it("falls back to Postgres when Redis is unavailable", async () => {
    const down = () => Promise.reject(new Error("Connection is closed."));
    vi.spyOn(redis, "get").mockImplementation(down);
    vi.spyOn(redis, "set").mockImplementation(down);

    const res = await summary(acme.analystToken, RANGE);

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.data.total).toBe(5);
  });
});
