import { cache } from "../../lib/redis.js";
import { analyticsVersionKey, summaryCacheKey } from "./analytics.cache-keys.js";
import * as analyticsRepository from "./analytics.repository.js";
import { summarySchema, type Summary, type SummaryQuery } from "./analytics.schema.js";

export const SUMMARY_CACHE_TTL_SECONDS = 60;

/**
 * Cache-aside with a per-org version in the key. If Redis is unavailable every
 * cache call degrades to a miss and the summary is computed from Postgres.
 */
export async function getSummary(orgId: string, query: SummaryQuery): Promise<{ summary: Summary; cacheHit: boolean }> {
  const version = (await cache.get(analyticsVersionKey(orgId))) ?? "0";
  const key = summaryCacheKey(orgId, version, query);

  const cached = await cache.getJson(key, summarySchema);
  if (cached) return { summary: cached, cacheHit: true };

  const { byType, daily } = await analyticsRepository.summarize(orgId, query);
  const summary: Summary = {
    range: { from: query.from, to: query.to, timezone: "UTC" },
    filters: { eventType: query.eventType ?? null, source: query.source ?? null },
    total: byType.reduce((sum, row) => sum + row.count, 0),
    byType,
    daily,
  };

  await cache.setJson(key, summary, SUMMARY_CACHE_TTL_SECONDS);
  return { summary, cacheHit: false };
}
