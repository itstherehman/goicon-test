import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { cache } from "../../lib/redis.js";
import { HttpError } from "../../utils/http-error.js";
import { analyticsVersionKey } from "../analytics/analytics.cache-keys.js";
import { buildSearchText } from "./search-text.js";
import * as eventsRepository from "./events.repository.js";
import type { EventRecord } from "./events.repository.js";
import { encodeCursor, type CreateEventBody, type ListEventsQuery } from "./events.schema.js";

export type IngestResult = { event: EventRecord; replayed: boolean };

/** JSON with object keys sorted, so key order doesn't change the hash. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(",")}}`;
}

// occurredAt is hashed as a normalized instant: "…Z" and "…+00:00" are the same request.
function hashRequest(body: CreateEventBody): string {
  const normalized = { ...body, occurredAt: body.occurredAt.toISOString() };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

function resolveExisting(existing: { event: EventRecord; requestHash: string | null }, requestHash: string): IngestResult {
  if (existing.requestHash !== requestHash) {
    throw new HttpError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used with a different request body",
    );
  }
  return { event: existing.event, replayed: true };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Creates an event for `orgId` (always taken from the authenticated user).
 * With an idempotency key: same key + same body → the original event (replayed),
 * same key + different body → 409. Concurrent duplicates are settled by the
 * (org_id, idempotency_key) unique index rather than the pre-check.
 */
export async function ingestEvent(orgId: string, body: CreateEventBody, idempotencyKey?: string): Promise<IngestResult> {
  const requestHash = idempotencyKey ? hashRequest(body) : undefined;

  if (idempotencyKey && requestHash) {
    const existing = await eventsRepository.findByIdempotencyKey(orgId, idempotencyKey);
    if (existing) return resolveExisting(existing, requestHash);
  }

  let event: EventRecord;
  try {
    event = await eventsRepository.insertEvent(orgId, {
      eventType: body.eventType,
      occurredAt: body.occurredAt,
      source: body.source,
      metadata: body.metadata as Prisma.InputJsonObject,
      searchText: buildSearchText(body.eventType, body.source, body.metadata),
      idempotencyKey,
      requestHash,
    });
  } catch (err) {
    // Lost a race with a concurrent request using the same key: return what it created.
    if (idempotencyKey && requestHash && isUniqueViolation(err)) {
      const existing = await eventsRepository.findByIdempotencyKey(orgId, idempotencyKey);
      if (existing) return resolveExisting(existing, requestHash);
    }
    throw err;
  }

  await cache.incr(analyticsVersionKey(orgId));
  return { event, replayed: false };
}

export type EventPage = {
  data: EventRecord[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};

export async function listEvents(orgId: string, query: ListEventsQuery): Promise<EventPage> {
  const { limit, cursor, ...filters } = query;

  // Fetch one extra row to know whether another page exists without a COUNT(*).
  const rows = await eventsRepository.listEvents(orgId, filters, { take: limit + 1, after: cursor });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    page: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null },
  };
}
