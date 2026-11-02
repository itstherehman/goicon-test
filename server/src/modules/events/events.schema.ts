import { z } from "zod";
import { EventType } from "../../generated/prisma/client.js";

export const METADATA_MAX_BYTES = 8 * 1024;
export const METADATA_MAX_DEPTH = 5;
const MIN_OCCURRED_AT = Date.parse("2000-01-01T00:00:00Z");
// Allow some client clock skew, but not events "from the future".
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export const eventTypeSchema = z.enum(EventType, {
  error: `eventType must be one of: ${Object.values(EventType).join(", ")}`,
});

/** ISO-8601 with an explicit offset ("Z" or "+05:00"); a bare local time is ambiguous. */
export const isoDateTimeSchema = z
  .iso.datetime({ offset: true, error: "Must be an ISO-8601 date-time with a timezone, e.g. 2026-01-31T09:30:00Z" })
  .transform((value) => new Date(value));

/** Nesting depth: {} is 1, {"a":{}} is 2, arrays count as a level. */
function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
  return 1 + children.reduce<number>((max, child) => Math.max(max, jsonDepth(child)), 0);
}

export const metadataSchema = z
  .record(z.string(), z.json(), { error: "metadata must be a JSON object" })
  .superRefine((value, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > METADATA_MAX_BYTES) {
      ctx.addIssue({ code: "custom", message: `metadata must be at most ${METADATA_MAX_BYTES} bytes (got ${bytes})` });
      return;
    }
    if (jsonDepth(value) > METADATA_MAX_DEPTH) {
      ctx.addIssue({ code: "custom", message: `metadata must be nested at most ${METADATA_MAX_DEPTH} levels deep` });
    }
  });

export const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:/-]+$/, "source may only contain letters, digits and . _ : / -");

// .strict(): unknown keys such as orgId/tenantId are rejected, never silently trusted.
export const createEventBodySchema = z
  .object({
    eventType: eventTypeSchema,
    occurredAt: isoDateTimeSchema.refine(
      (date) => date.getTime() >= MIN_OCCURRED_AT && date.getTime() <= Date.now() + MAX_FUTURE_SKEW_MS,
      { error: "occurredAt must be between 2000-01-01 and 24 hours from now" },
    ),
    source: sourceSchema,
    metadata: metadataSchema,
  })
  .strict();

export const ingestHeadersSchema = z.object({
  "idempotency-key": z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\x21-\x7E]+$/, "Idempotency-Key must be printable ASCII without spaces")
    .optional(),
});

export type CreateEventBody = z.infer<typeof createEventBodySchema>;
export type IngestHeaders = z.infer<typeof ingestHeadersSchema>;

// ---- GET /api/events ----

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

const cursorPayloadSchema = z.object({ t: z.iso.datetime(), id: z.uuid() });
export type Cursor = { occurredAt: Date; id: string };

/** Opaque cursor: base64url of {"t": occurredAt, "id": id} of the last row on the page. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.occurredAt.toISOString(), id: cursor.id })).toString("base64url");
}

const cursorSchema = z.string().transform((value, ctx): Cursor => {
  try {
    const payload = cursorPayloadSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { occurredAt: new Date(payload.t), id: payload.id };
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
});

/** Shared by list + analytics: from is inclusive, to is exclusive. */
export const dateRangeFields = {
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
};

export const fromBeforeTo = (value: { from?: Date; to?: Date }) => !value.from || !value.to || value.from < value.to;
export const fromBeforeToIssue = { error: "from must be earlier than to", path: ["to"] };

// .strict(): unknown params (including orgId/tenantId) are a 400, not silently ignored.
export const listEventsQuerySchema = z
  .object({
    ...dateRangeFields,
    eventType: eventTypeSchema.optional(),
    source: sourceSchema.optional(),
    q: z.string().trim().min(2, "q must be at least 2 characters").max(100).optional(),
    limit: z.coerce
      .number({ error: "limit must be a number" })
      .int()
      .min(1)
      .max(PAGE_SIZE_MAX, `limit must be at most ${PAGE_SIZE_MAX}`)
      .default(PAGE_SIZE_DEFAULT),
    cursor: cursorSchema.optional(),
  })
  .strict()
  .refine(fromBeforeTo, fromBeforeToIssue);

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
