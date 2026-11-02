import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/lib/redis.js";
import { analyticsVersionKey } from "../src/modules/analytics/analytics.cache-keys.js";
import { createTestOrg, deleteTestOrgs, type TestOrg } from "./helpers/fixtures.js";

const app = createApp();
let acme: TestOrg;
let globex: TestOrg;

beforeAll(async () => {
  [acme, globex] = await Promise.all([createTestOrg("Acme"), createTestOrg("Globex")]);
});

afterAll(async () => {
  await deleteTestOrgs(acme, globex);
});

const validEvent = () => ({
  eventType: "payment_failed",
  occurredAt: "2026-10-01T12:30:00Z",
  source: "billing-service",
  metadata: { invoiceId: "inv_123", amountCents: 4200, card: { brand: "visa" } },
});

const post = (token: string, body: unknown, idempotencyKey?: string) => {
  const req = request(app).post("/api/events").set("Authorization", `Bearer ${token}`);
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send(body as object);
};

describe("POST /api/events: auth", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/events").send(validEvent());
    expect(res.status).toBe(401);
  });

  it("returns 403 for an Analyst, even with an invalid body", async () => {
    const res = await post(acme.analystToken, { nonsense: true });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/events: ingestion", () => {
  it("creates the event under the caller's organisation", async () => {
    const res = await post(acme.adminToken, validEvent());

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      eventType: "payment_failed",
      occurredAt: "2026-10-01T12:30:00.000Z",
      source: "billing-service",
      metadata: validEvent().metadata,
      idempotencyKey: null,
      receivedAt: expect.any(String),
    });

    const row = await prisma.event.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.orgId).toBe(acme.org.id);
    expect(row.searchText).toBe("payment_failed billing-service inv_123 4200 visa");
  });

  it("normalizes occurredAt offsets to UTC", async () => {
    const res = await post(acme.adminToken, { ...validEvent(), occurredAt: "2026-10-01T17:30:00+05:00" });

    expect(res.status).toBe(201);
    expect(res.body.data.occurredAt).toBe("2026-10-01T12:30:00.000Z");
  });

  it("stores the exact UTC instant (independent of the DB server's timezone)", async () => {
    const res = await post(acme.adminToken, { ...validEvent(), occurredAt: "2026-10-01T00:00:00Z" });

    const [row] = await prisma.$queryRaw<{ utc: string }[]>`
      SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS utc FROM events WHERE id = ${res.body.data.id}::uuid`;
    expect(row!.utc).toBe("2026-10-01T00:00:00");
  });

  it("bumps the org's analytics cache version", async () => {
    const before = Number((await redis.get(analyticsVersionKey(acme.org.id))) ?? 0);
    await post(acme.adminToken, validEvent());
    const after = Number(await redis.get(analyticsVersionKey(acme.org.id)));

    expect(after).toBe(before + 1);
  });
});

describe("POST /api/events: validation", () => {
  const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }; // 6 levels

  it.each([
    ["missing eventType", { eventType: undefined }, "eventType"],
    ["missing occurredAt", { occurredAt: undefined }, "occurredAt"],
    ["missing source", { source: undefined }, "source"],
    ["missing metadata", { metadata: undefined }, "metadata"],
    ["unsupported eventType", { eventType: "user_deleted" }, "eventType"],
    ["non-date occurredAt", { occurredAt: "yesterday" }, "occurredAt"],
    ["impossible date", { occurredAt: "2026-02-30T10:00:00Z" }, "occurredAt"],
    ["date without timezone", { occurredAt: "2026-10-01T12:30:00" }, "occurredAt"],
    ["date far in the future", { occurredAt: "2099-01-01T00:00:00Z" }, "occurredAt"],
    ["date before 2000", { occurredAt: "1999-12-31T23:59:59Z" }, "occurredAt"],
    ["empty source", { source: "  " }, "source"],
    ["source with spaces", { source: "billing service" }, "source"],
    ["metadata array", { metadata: [1, 2] }, "metadata"],
    ["metadata null", { metadata: null }, "metadata"],
    ["metadata string", { metadata: "{}" }, "metadata"],
    ["metadata too deep", { metadata: deep }, "metadata"],
    ["metadata over 8KB", { metadata: { blob: "x".repeat(9000) } }, "metadata"],
  ])("returns 400 for %s", async (_label, override, path) => {
    const res = await post(acme.adminToken, { ...validEvent(), ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ location: "body", path })]));
  });

  it.each(["orgId", "tenantId"])("rejects a client-supplied %s instead of trusting it", async (key) => {
    const res = await post(acme.adminToken, { ...validEvent(), [key]: globex.org.id });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain(key);
    expect(await prisma.event.count({ where: { orgId: globex.org.id } })).toBe(0);
  });

  it("returns 400 for an invalid Idempotency-Key header", async () => {
    const res = await post(acme.adminToken, validEvent(), "k".repeat(256));

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: "headers", path: "idempotency-key" });
  });
});

describe("POST /api/events: idempotency", () => {
  it("returns the original event when the same key and body are repeated", async () => {
    const key = randomUUID();

    const first = await post(acme.adminToken, validEvent(), key);
    const second = await post(acme.adminToken, validEvent(), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.data).toEqual(first.body.data);
    expect(await prisma.event.count({ where: { orgId: acme.org.id, idempotencyKey: key } })).toBe(1);
  });

  it("treats reordered keys and equivalent timestamps as the same request", async () => {
    const key = randomUUID();
    const { metadata, ...rest } = validEvent();

    await post(acme.adminToken, validEvent(), key);
    const replay = await post(
      acme.adminToken,
      { metadata: { card: metadata.card, amountCents: 4200, invoiceId: "inv_123" }, ...rest, occurredAt: "2026-10-01T12:30:00.000+00:00" },
      key,
    );

    expect(replay.status).toBe(200);
  });

  it("returns 409 when the key is reused with a different body", async () => {
    const key = randomUUID();

    await post(acme.adminToken, validEvent(), key);
    const res = await post(acme.adminToken, { ...validEvent(), source: "other-service" }, key);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("scopes keys per organisation", async () => {
    const key = randomUUID();

    const acmeRes = await post(acme.adminToken, validEvent(), key);
    const globexRes = await post(globex.adminToken, validEvent(), key);

    expect(acmeRes.status).toBe(201);
    expect(globexRes.status).toBe(201);
    expect(globexRes.body.data.id).not.toBe(acmeRes.body.data.id);
  });

  it("creates exactly one event under concurrent requests with the same key", async () => {
    const key = randomUUID();

    const responses = await Promise.all(Array.from({ length: 8 }, () => post(acme.adminToken, validEvent(), key)));

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
    expect(await prisma.event.count({ where: { orgId: acme.org.id, idempotencyKey: key } })).toBe(1);
  });

  it("creates a new event each time when no key is sent", async () => {
    const first = await post(acme.adminToken, validEvent());
    const second = await post(acme.adminToken, validEvent());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });
});
