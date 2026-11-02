import type { SummaryQuery } from "./analytics.schema.js";

/**
 * Per-org version counter. Ingest INCRs it; analytics cache keys embed it, so new
 * events make every cached summary for that org unreachable without SCAN/DEL.
 */
export const analyticsVersionKey = (orgId: string) => `analytics:ver:${orgId}`;

/**
 * Every dimension that changes the result is in the key: org, data version, range
 * and each filter. Values are URI-encoded so a ":" in a source can't collide.
 */
export function summaryCacheKey(orgId: string, version: string, query: SummaryQuery): string {
  const part = (value: string | undefined) => (value === undefined ? "*" : encodeURIComponent(value));
  return [
    "analytics:v1:summary",
    `org=${orgId}`,
    `ver=${version}`,
    `from=${query.from}`,
    `to=${query.to}`,
    `type=${part(query.eventType)}`,
    `source=${part(query.source)}`,
  ].join(":");
}
