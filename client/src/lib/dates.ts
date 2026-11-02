// All dates in the UI are UTC days (YYYY-MM-DD), matching the API.

const DAY_MS = 24 * 60 * 60 * 1000

export const todayUtc = () => new Date().toISOString().slice(0, 10)

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** Inclusive day range → the list API's [from, to) instants. */
export function dayRangeToInstants(from: string, to: string) {
  return {
    from: from ? `${from}T00:00:00Z` : undefined,
    to: to ? `${addDays(to, 1)}T00:00:00Z` : undefined,
  }
}

export const formatDateTime = (iso: string) => iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
