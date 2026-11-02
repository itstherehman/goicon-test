/**
 * Builds the lower-cased text that `q` searches: event type, source and every
 * scalar value in metadata (keys are skipped so "reason" doesn't match every row).
 */
export function buildSearchText(eventType: string, source: string, metadata: Record<string, unknown>): string {
  const parts: string[] = [eventType, source];

  const collect = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (typeof value === "object") return Object.values(value).forEach(collect);
    parts.push(String(value));
  };
  collect(metadata);

  return parts.join(" ").toLowerCase();
}
