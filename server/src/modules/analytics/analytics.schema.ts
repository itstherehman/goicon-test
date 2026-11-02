import { z } from "zod";
import { EventType } from "../../generated/prisma/client.js";
import { eventTypeSchema, sourceSchema } from "../events/events.schema.js";

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const toDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => toDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

/**
 * Whole UTC days, both ends inclusive. Day granularity keeps cache keys stable
 * (a default "last 30 days" doesn't change every millisecond) and matches the daily buckets.
 */
export const summaryQuerySchema = z
  .object({
    from: z.iso.date({ error: "from must be a date (YYYY-MM-DD)" }).optional(),
    to: z.iso.date({ error: "to must be a date (YYYY-MM-DD)" }).optional(),
    eventType: eventTypeSchema.optional(),
    source: sourceSchema.optional(),
  })
  .strict()
  .transform((query, ctx) => {
    const to = query.to ?? toDay(new Date());
    const from = query.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));

    if (from > to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "from must be on or before to" });
      return z.NEVER;
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["from"], message: `Date range must be at most ${MAX_RANGE_DAYS} days` });
      return z.NEVER;
    }

    return { from, to, eventType: query.eventType, source: query.source };
  });

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

// Also used to validate values read back from Redis.
export const summarySchema = z.object({
  range: z.object({ from: z.string(), to: z.string(), timezone: z.literal("UTC") }),
  filters: z.object({ eventType: z.enum(EventType).nullable(), source: z.string().nullable() }),
  total: z.number().int(),
  byType: z.array(z.object({ eventType: z.enum(EventType), count: z.number().int() })),
  daily: z.array(z.object({ date: z.string(), count: z.number().int() })),
});

export type Summary = z.infer<typeof summarySchema>;
