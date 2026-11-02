import { prisma } from "../../db/prisma.js";
import { Prisma, type EventType } from "../../generated/prisma/client.js";

export type SummaryFilters = {
  from: string; // YYYY-MM-DD, inclusive (UTC)
  to: string; // YYYY-MM-DD, inclusive (UTC)
  eventType?: EventType;
  source?: string;
};

export type TypeCount = { eventType: EventType; count: number };
export type DayCount = { date: string; count: number };

/**
 * Aggregates in Postgres; only grouped rows (≤ 6 types, ≤ 366 days) leave the database.
 * Tenant scoping: org_id is always the first predicate, matching the leading index column.
 */
export async function summarize(orgId: string, filters: SummaryFilters) {
  // Bounds are explicit UTC instants (ISO strings with "Z", cast to timestamptz), so they
  // never depend on the DB session timezone and always line up with the UTC day buckets.
  const start = new Date(`${filters.from}T00:00:00Z`).toISOString();
  const end = new Date(Date.parse(`${filters.to}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString();

  const conditions = [
    Prisma.sql`org_id = ${orgId}::uuid`,
    Prisma.sql`occurred_at >= ${start}::timestamptz`,
    Prisma.sql`occurred_at < ${end}::timestamptz`,
  ];
  if (filters.eventType) conditions.push(Prisma.sql`event_type = ${filters.eventType}::"EventType"`);
  if (filters.source) conditions.push(Prisma.sql`source = ${filters.source}`);
  const where = Prisma.join(conditions, " AND ");

  const byTypeQuery = prisma.$queryRaw<TypeCount[]>`
    SELECT event_type::text AS "eventType", COUNT(*)::int AS count
    FROM events
    WHERE ${where}
    GROUP BY event_type
    ORDER BY count DESC, event_type`;

  // generate_series zero-fills days with no events so the trend has no gaps.
  const dailyQuery = prisma.$queryRaw<DayCount[]>`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(c.count, 0)::int AS count
    FROM generate_series(${filters.from}::date, ${filters.to}::date, interval '1 day') AS d(day)
    LEFT JOIN (
      SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count
      FROM events
      WHERE ${where}
      GROUP BY 1
    ) c ON c.day = d.day::date
    ORDER BY d.day`;

  // One REPEATABLE READ snapshot, so total, byType and daily always agree with each other.
  const [byType, daily] = await prisma.$transaction([byTypeQuery, dailyQuery], {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });

  return { byType, daily };
}
