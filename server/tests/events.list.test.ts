import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { EventType } from "../src/generated/prisma/client.js";
import { encodeCursor } from "../src/modules/events/events.schema.js";
import { createTestOrg, deleteTestOrgs, insertEvents, type TestOrg } from "./helpers/fixtures.js";

const app = createApp();
let acme: TestOrg;
let globex: TestOrg;
let empty: TestOrg;

type EventBody = { id: string; eventType: string; occurredAt: string; source: string };
type PageBody = { data: EventBody[]; page: { limit: number; nextCursor: string | null; hasMore: boolean } };

const TIE = "2026-10-05T00:00:00.000Z";

beforeAll(async () => {
  [acme, globex, empty] = await Promise.all([createTestOrg("Acme"), createTestOrg("Globex"), createTestOrg("Empty")]);

  await insertEvents(acme.org.id, [
    { occurredAt: "2026-10-01T10:00:00Z", eventType: EventType.payment_failed, source: "billing-service", metadata: { invoiceId: "INV_100", reason: "card_declined" } },
    { occurredAt: "2026-10-02T10:00:00Z", eventType: EventType.payment_succeeded, source: "billing-service", metadata: { invoiceId: "inv_200" } },
    { occurredAt: "2026-10-03T10:00:00Z", eventType: EventType.job_completed, source: "scheduler", metadata: { jobId: "job_1" } },
    { occurredAt: "2026-10-04T10:00:00Z", eventType: EventType.job_failed, source: "scheduler", metadata: { jobId: "job_2", note: "100% cpu" } },
    // Five events sharing one timestamp: pagination must split them by id without gaps or repeats.
    ...Array.from({ length: 5 }, (_, i) => ({ occurredAt: TIE, eventType: EventType.user_invited, source: "web-app", metadata: { inviteId: `invite_${i}` } })),
  ]);

  await insertEvents(globex.org.id, [
    { occurredAt: "2026-10-03T10:00:00Z", eventType: EventType.payment_failed, source: "payments-api", metadata: { invoiceId: "inv_100" } },
  ]);
});

afterAll(async () => {
  await deleteTestOrgs(acme, globex, empty);
});

const list = (token: string, query: Record<string, string | number> = {}) =>
  request(app).get("/api/events").query(query).set("Authorization", `Bearer ${token}`);

async function collectAllPages(token: string, query: Record<string, string | number>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await list(token, { ...query, ...(cursor && { cursor }) });
    expect(res.status).toBe(200);
    const body = res.body as PageBody;
    ids.push(...body.data.map((e) => e.id));
    cursor = body.page.nextCursor;
    expect(body.page.hasMore).toBe(cursor !== null);
    pages++;
  } while (cursor && pages < 20);
  return { ids, pages };
}

describe("GET /api/events: auth and tenancy", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/events");
    expect(res.status).toBe(401);
  });

  it("lets both Admin and Analyst read", async () => {
    expect((await list(acme.adminToken)).status).toBe(200);
    expect((await list(acme.analystToken)).status).toBe(200);
  });

  it("only returns the caller's organisation's events", async () => {
    const acmeRes = await list(acme.analystToken, { limit: 100 });
    const globexRes = await list(globex.analystToken, { limit: 100 });

    expect(acmeRes.body.data).toHaveLength(9);
    expect(globexRes.body.data).toHaveLength(1);
    expect(globexRes.body.data[0].source).toBe("payments-api");
  });

  it("does not leak another org's data through matching filters or search", async () => {
    const res = await list(globex.analystToken, { source: "billing-service" });
    const search = await list(globex.analystToken, { q: "card_declined" });

    expect(res.body.data).toEqual([]);
    expect(search.body.data).toEqual([]);
  });

  it("ignores another org's cursor beyond its position (still scoped to the caller)", async () => {
    const acmeFirst = await list(acme.analystToken, { limit: 1 });
    const res = await list(globex.analystToken, { cursor: acmeFirst.body.page.nextCursor });

    expect(res.body.data.map((e: EventBody) => e.source)).toEqual(["payments-api"]);
  });

  it.each(["orgId", "tenantId"])("rejects a %s query parameter with 400", async (key) => {
    const res = await list(globex.analystToken, { [key]: acme.org.id });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain(key);
  });
});

describe("GET /api/events: pagination", () => {
  it("returns a stable shape with defaults", async () => {
    const res = await list(acme.analystToken);

    expect(res.body).toEqual({
      data: expect.any(Array),
      page: { limit: 25, nextCursor: null, hasMore: false },
    });
  });

  it("orders by occurredAt desc, then id desc", async () => {
    const { body } = await list(acme.analystToken, { limit: 100 });
    const events = body.data as EventBody[];

    const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    expect(events.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
    expect(events[0]!.occurredAt).toBe(TIE);
  });

  it.each([1, 2, 3, 4])("walks every row exactly once with limit=%i, including timestamp ties", async (limit) => {
    const all = (await list(acme.analystToken, { limit: 100 })).body.data.map((e: EventBody) => e.id);

    const { ids, pages } = await collectAllPages(acme.analystToken, { limit });

    expect(ids).toEqual(all);
    expect(pages).toBe(Math.ceil(all.length / limit));
  });

  it("is not disturbed by newer events inserted while paging", async () => {
    const tmp = await createTestOrg("Tmp");
    await insertEvents(tmp.org.id, [
      { occurredAt: "2026-10-01T00:00:00Z" },
      { occurredAt: "2026-10-02T00:00:00Z" },
      { occurredAt: "2026-10-03T00:00:00Z" },
    ]);

    const first = await list(tmp.analystToken, { limit: 2 });
    await insertEvents(tmp.org.id, [{ occurredAt: "2026-10-04T00:00:00Z" }]);
    const second = await list(tmp.analystToken, { limit: 2, cursor: first.body.page.nextCursor });

    expect(second.body.data.map((e: EventBody) => e.occurredAt)).toEqual(["2026-10-01T00:00:00.000Z"]);
    expect(second.body.page).toEqual({ limit: 2, nextCursor: null, hasMore: false });
    await deleteTestOrgs(tmp);
  });

  it("returns an empty page (200) for an org with no events", async () => {
    const res = await list(empty.analystToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } });
  });
});

describe("GET /api/events: filters", () => {
  const sources = (res: { body: PageBody }) => res.body.data.map((e) => e.source);

  it("filters by date range (from inclusive, to exclusive)", async () => {
    const res = await list(acme.analystToken, { from: "2026-10-02T10:00:00Z", to: "2026-10-04T10:00:00Z" });

    expect(res.body.data.map((e: EventBody) => e.occurredAt)).toEqual([
      "2026-10-03T10:00:00.000Z",
      "2026-10-02T10:00:00.000Z",
    ]);
  });

  it("filters by eventType", async () => {
    const res = await list(acme.analystToken, { eventType: "job_failed" });
    expect(res.body.data.map((e: EventBody) => e.eventType)).toEqual(["job_failed"]);
  });

  it("filters by source", async () => {
    const res = await list(acme.analystToken, { source: "scheduler" });
    expect(sources(res)).toEqual(["scheduler", "scheduler"]);
  });

  it("searches metadata values case-insensitively", async () => {
    const res = await list(acme.analystToken, { q: "inv_100" });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].eventType).toBe("payment_failed");
  });

  it("treats LIKE wildcards in q literally", async () => {
    const percent = await list(acme.analystToken, { q: "0%" });
    // Unescaped, "d_s" would match "job_completed scheduler" and "job_failed scheduler" via "d s".
    const underscore = await list(acme.analystToken, { q: "d_s" });

    expect(percent.body.data.map((e: EventBody) => e.eventType)).toEqual(["job_failed"]); // only "100% cpu"
    expect(underscore.body.data).toEqual([]);
  });

  it("combines filters", async () => {
    const res = await list(acme.analystToken, { source: "billing-service", eventType: "payment_succeeded", q: "inv" });
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/events: validation", () => {
  const validCursor = encodeCursor({ occurredAt: new Date(TIE), id: "00000000-0000-7000-8000-000000000000" });

  it.each([
    ["limit=0", { limit: 0 }, "limit"],
    ["limit over the cap", { limit: 101 }, "limit"],
    ["non-numeric limit", { limit: "ten" }, "limit"],
    ["fractional limit", { limit: 2.5 }, "limit"],
    ["malformed from", { from: "2026-13-01" }, "from"],
    ["from after to", { from: "2026-10-05T00:00:00Z", to: "2026-10-01T00:00:00Z" }, "to"],
    ["from equal to to", { from: "2026-10-05T00:00:00Z", to: "2026-10-05T00:00:00Z" }, "to"],
    ["unsupported eventType", { eventType: "nope" }, "eventType"],
    ["one-character q", { q: "a" }, "q"],
    ["garbage cursor", { cursor: "not-a-cursor" }, "cursor"],
    ["tampered cursor", { cursor: Buffer.from('{"t":"x","id":"y"}').toString("base64url") }, "cursor"],
    ["unknown parameter", { sort: "asc" }, ""],
  ])("returns 400 for %s", async (_label, query, path) => {
    const res = await list(acme.analystToken, query);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ location: "query", path })]));
  });

  it("returns 400 when a parameter is repeated", async () => {
    const res = await request(app).get("/api/events?limit=1&limit=2").set("Authorization", `Bearer ${acme.analystToken}`);
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed cursor", async () => {
    const res = await list(acme.analystToken, { cursor: validCursor });
    expect(res.status).toBe(200);
  });
});
