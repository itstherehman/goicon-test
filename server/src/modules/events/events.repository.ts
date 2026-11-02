import { prisma } from "../../db/prisma.js";
import type { EventType, Prisma } from "../../generated/prisma/client.js";

/**
 * The only module that queries the events table. Every function takes the caller's
 * orgId as its first argument and includes it in the WHERE clause / row, so tenant
 * scoping can't be forgotten by a controller or service.
 */

// Public shape: internal columns (orgId, searchText, requestHash) are never selected.
const eventSelect = {
  id: true,
  eventType: true,
  occurredAt: true,
  source: true,
  metadata: true,
  idempotencyKey: true,
  receivedAt: true,
} satisfies Prisma.EventSelect;

export type EventRecord = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

export type NewEvent = {
  eventType: EventType;
  occurredAt: Date;
  source: string;
  metadata: Prisma.InputJsonObject;
  searchText: string;
  idempotencyKey?: string;
  requestHash?: string;
};

export async function insertEvent(orgId: string, data: NewEvent): Promise<EventRecord> {
  return prisma.event.create({ data: { ...data, orgId }, select: eventSelect });
}

export async function findByIdempotencyKey(
  orgId: string,
  idempotencyKey: string,
): Promise<{ event: EventRecord; requestHash: string | null } | null> {
  const row = await prisma.event.findUnique({
    where: { orgId_idempotencyKey: { orgId, idempotencyKey } },
    select: { ...eventSelect, requestHash: true },
  });
  if (!row) return null;
  const { requestHash, ...event } = row;
  return { event, requestHash };
}

export type EventFilters = {
  from?: Date;
  to?: Date;
  eventType?: EventType;
  source?: string;
  q?: string;
};

/** Escape LIKE wildcards: Prisma's `contains` passes % and _ through unescaped. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Keyset pagination ordered by (occurredAt DESC, id DESC); id breaks ties so the
 * order is total and pages never skip or repeat rows. Returns up to `take` rows.
 */
export async function listEvents(
  orgId: string,
  filters: EventFilters,
  page: { take: number; after?: { occurredAt: Date; id: string } },
): Promise<EventRecord[]> {
  const where: Prisma.EventWhereInput = {
    orgId,
    eventType: filters.eventType,
    source: filters.source,
    // search_text is stored lower-cased, so a lower-cased LIKE is case-insensitive and can use the trigram index.
    searchText: filters.q ? { contains: escapeLike(filters.q.toLowerCase()) } : undefined,
    AND: [
      { occurredAt: { gte: filters.from, lt: filters.to } },
      // "Rows after the cursor": (occurredAt, id) < (cursor.occurredAt, cursor.id).
      // The lte bound lets Postgres range-scan the index; the OR settles ties on id.
      ...(page.after
        ? [
            { occurredAt: { lte: page.after.occurredAt } },
            { OR: [{ occurredAt: { lt: page.after.occurredAt } }, { id: { lt: page.after.id } }] },
          ]
        : []),
    ],
  };

  return prisma.event.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: page.take,
    select: eventSelect,
  });
}
