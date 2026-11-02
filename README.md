# Ops Analytics

A small multi-tenant operations analytics service. Organisations submit operational events (`job_failed`, `payment_failed`, …); authenticated users explore them with filters and cursor pagination, and view a dashboard with totals, counts by type and a daily trend.

**Stack:** Express 5 + TypeScript, Prisma 7 (PostgreSQL), Zod, Redis (ioredis), pino · React 19 + Vite + Recharts · Vitest + Supertest against a real database.

The focus is the backend: tenant isolation, RBAC, idempotent ingestion, deterministic pagination, database-side aggregation, caching and failure handling. The UI is intentionally plain.

---

## Quick start

Prerequisites: Node 20+, a local PostgreSQL (with the bundled `pg_trgm` extension, standard in most distributions), and Redis (via Docker below, or a local install).

```bash
npm run install:all                 # root + server + client

docker compose up -d                # Redis on :6379 (skip if you already run Redis locally)

createdb app_dev && createdb app_test
cp server/.env.example server/.env  # set DATABASE_URL and a JWT_SECRET (≥ 32 chars)
# server/.env.test is committed; adjust its DATABASE_URL user if yours isn't "mac"

npm --prefix server run db:deploy   # apply migrations
npm --prefix server run db:seed     # 2 orgs, 4 users, 5,000 events over 90 days

npm run dev                         # API :4000, client :5173 (proxies /api)
npm test                            # migrates app_test, runs 115 server tests
```

### Seeded users

All passwords: `Password123!`

| Email | Org | Role |
| --- | --- | --- |
| `admin@acme.test` | Acme Corp (3,000 events) | Admin |
| `analyst@acme.test` | Acme Corp | Analyst |
| `admin@globex.test` | Globex Inc (2,000 events) | Admin |
| `analyst@globex.test` | Globex Inc | Analyst |

Each org uses different `source` values (Acme: `billing-service`, `scheduler`, `web-app`; Globex: `payments-api`, `etl-pipeline`, `admin-portal`), so any cross-tenant leak is immediately visible.

---

## API

All non-2xx responses share one shape:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": [{ "location": "body", "path": "occurredAt", "message": "…" }] } }
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` / `INVALID_JSON` | Validation failure (per-field `details`), malformed JSON |
| 401 | `UNAUTHORIZED` | Missing, malformed, expired or forged token; bad credentials |
| 403 | `FORBIDDEN` | Authenticated but role not allowed (Analyst ingesting) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same `Idempotency-Key` with a different body |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 64 KB |
| 503 | `SERVICE_UNAVAILABLE` | Database unreachable |

| Endpoint | Roles | Notes |
| --- | --- | --- |
| `POST /api/auth/login` | public | `{ email, password }` → `{ token, expiresIn, user }` |
| `GET /api/auth/me` | any | Current user + organisation |
| `POST /api/events` | Admin | Optional `Idempotency-Key` header |
| `GET /api/events` | Admin, Analyst | `from`, `to` (ISO date-time), `eventType`, `source`, `q`, `limit` (1–100, default 25), `cursor` |
| `GET /api/analytics/summary` | Admin, Analyst | `from`, `to` (`YYYY-MM-DD`, inclusive, UTC; default last 30 days, max 366), `eventType`, `source` |
| `GET /api/health` | public | `{ status, db, redis }`; 503 only if the DB is down |

### Examples

```bash
API=http://localhost:4000/api
TOKEN=$(curl -s $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@acme.test","password":"Password123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# Ingest (201). Repeat it: 200 + "Idempotent-Replayed: true". Change the body, same key: 409.
curl -i $API/events -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-123' \
  -d '{"eventType":"payment_failed","occurredAt":"2026-10-01T12:30:00Z","source":"billing-service","metadata":{"invoiceId":"inv_9"}}'

# List with filters; follow page.nextCursor for the next page
curl "$API/events?eventType=payment_failed&q=card_declined&limit=10" -H "Authorization: Bearer $TOKEN"

# Dashboard summary; second call shows "X-Cache: HIT"
curl -i "$API/analytics/summary?from=2026-10-01&to=2026-10-31" -H "Authorization: Bearer $TOKEN"
```

Supported event types: `job_completed`, `job_failed`, `payment_succeeded`, `payment_failed`, `user_invited`, `workflow_delayed` (snake_case so the API, Prisma enum and raw SQL use identical values).

---

## Architecture

```
server/src/
  modules/
    auth/        login, /me
    events/      schema → controller → service → repository   (ingest + list)
    analytics/   schema → controller → service → repository   (summary + cache keys)
  middleware/    authenticate, require-role, validate, request-logger, error-handler
  lib/           jwt, redis (fail-open cache helpers), logger
  db/            prisma client (session TZ pinned to UTC), DB-error classification
client/src/
  lib/           api (token + errors), useApi (abortable fetch hook), types, dates
  components/    Login, Dashboard, EventsTable, StateMessage
```

A request passes through: request logger (request id) → `authenticate` (JWT → `req.user`) → `requireRole` → `validate` (Zod; body, query, headers) → controller → service → repository. Controllers never touch Prisma; repositories are the only code that queries events.

---

## Design decisions and trade-offs

### Authentication and authorisation
- **Email + password → JWT** (HS256 via `jose`, algorithm and issuer pinned, 1 h expiry). Claims `{ sub, orgId, role }` are validated with Zod after signature verification, so a correctly signed token with an unexpected role is still rejected.
- **Claims are trusted per request** (no DB lookup). Trade-off: a role change or user deletion takes effect only when the token expires. Production would use short-lived access tokens + refresh tokens, or a per-request membership check.
- **Login doesn't reveal which emails exist**: unknown email and wrong password return the same 401, and both perform one bcrypt comparison (against a dummy hash for unknown emails) so timing matches.
- **Client stores the token in memory + `sessionStorage`** and sends it as a Bearer header. Simple and CSRF-free, but readable by XSS. An `httpOnly`, `SameSite` cookie is the production alternative.
- **Order of checks:** `authenticate` → `requireRole` → `validate`, so an Analyst gets 403 without learning anything from validation errors.

### Tenant isolation (defence in layers)
1. **The org always comes from the verified token**, never from the request. Body and query schemas are `.strict()`, so a client-sent `orgId`/`tenantId` is a 400 rather than silently ignored.
2. **Data-access layer:** every repository function takes `orgId` as its first argument and puts it in the `WHERE` clause; no unscoped event query is exported. Raw analytics SQL uses `org_id = $1` as the first predicate.
3. **Cache:** the org id and every query dimension are part of the cache key (below), so one org's cached result can never be served to another.
4. **Tests** prove that org B can't read, filter, search, aggregate or cache-hit its way to org A's data, including when reusing org A's pagination cursor.

Postgres Row-Level Security would be a stronger backstop (it guards against a forgotten `WHERE`), at the cost of per-transaction `SET LOCAL` plumbing with pooled Prisma connections. That is my first follow-up.

### Idempotent ingestion
- Optional `Idempotency-Key` header (≤ 255 printable ASCII). The key and a SHA-256 hash of the normalised request (sorted keys, `occurredAt` as a UTC instant) are stored on the event row, with a **unique index on `(org_id, idempotency_key)`**.
- Same key + same body → 200 with the original event and `Idempotent-Replayed: true`. Same key + different body → 409. Keys are scoped per organisation.
- **Race-safe:** a pre-check handles the common case; under concurrency the unique index decides the winner, and the loser catches `P2002` and returns the winner's event. A test fires 8 concurrent requests: one 201, seven 200s, one row.
- Keys never expire (they live on the event row). A production system would usually expire them after 24–72 h.

### Validation
- `occurredAt` must be ISO-8601 **with an offset** (a bare local time is ambiguous). Impossible dates (Feb 30), dates before 2000 and dates more than 24 h in the future are rejected.
- `metadata` must be a JSON object (not an array, null or primitive), ≤ 8 KB, nested ≤ 5 levels. A DB `CHECK (jsonb_typeof(metadata) = 'object')` backs this up.
- `source`: 1–100 characters of `[A-Za-z0-9._:/-]`.

### Pagination
- **Keyset (cursor) pagination** ordered by `occurred_at DESC, id DESC`. The id makes the order total, so rows with identical timestamps never repeat or vanish across pages. Tests walk every page at limits 1–4 over five same-timestamp events.
- The cursor is opaque base64url of `{ t, id }` of the last row; tampered or garbage cursors return 400. The server fetches `limit + 1` rows to compute `hasMore` without a `COUNT(*)`.
- Inserts made while paging don't shift later pages (unlike OFFSET).
- **Limitation:** a cursor records a position, not the filters it was created with. Reusing it with different filters is still correct and deterministic (it continues from that position), just not meaningful. Binding filters into the cursor would close that gap.
- `limit` above 100 is a 400 rather than silently clamped, so callers learn the contract.

### Search (`q`)
- A `search_text` column (lower-cased event type + source + metadata **values**) is written at insert and searched with `LIKE '%q%'` using a **`pg_trgm` GIN index**.
- **Prisma's `contains` does not escape `%` or `_`** (`q=%` matched every row), so the repository escapes them. A test asserts that both are treated literally.
- Trade-off: the trigram index isn't org-prefixed, so Postgres finds matches across orgs and then filters by `org_id`. At large scale, a `btree_gin` composite `(org_id, search_text)` index or per-tenant partitioning would fix this.

### Analytics
- **Database-side aggregation:** two grouped queries (`GROUP BY event_type`, and `GROUP BY` UTC day with a `generate_series` left join to zero-fill empty days). At most 6 + 366 rows leave the database; raw events never do.
- Both queries run in one **`REPEATABLE READ` transaction**, so `total`, `byType` and `daily` always agree even while events are being ingested.
- **Dates are UTC calendar days (`YYYY-MM-DD`, both inclusive)**, not timestamps: this matches the daily buckets and keeps cache keys stable (a default "last 30 days" computed to the millisecond would never produce a cache hit). Per-user time zones are a follow-up; the tz would then become part of the cache key.

### Caching (Redis)
- Cache-aside, 60 s TTL. Key: `analytics:v1:summary:org=<id>:ver=<n>:from=…:to=…:type=…:source=…` (values URI-encoded, so a `:` in a source can't collide).
- **Freshness via a per-org version counter:** ingest does `INCR analytics:ver:<org>`, and the version is part of the key. New events are visible on the next request with no `SCAN`/`DEL`, and an ingest in one org never touches another org's cache.
- Cached values are re-validated with Zod on read; anything malformed is treated as a miss. The `X-Cache: HIT|MISS` header makes behaviour observable.
- **Bounded staleness:** if the `INCR` fails (Redis down during ingest) or the version key is evicted, results can be stale for at most one TTL.

### Failure handling
| Failure | Behaviour |
| --- | --- |
| Redis down | **Fail open**: no offline queue, 1 s connect / 500 ms command timeouts, cache calls behave as misses, summary computed from Postgres. Logged once per outage, not per request. Health reports `degraded` (200). |
| Postgres down | 503 `SERVICE_UNAVAILABLE` (Prisma connection errors classified in `db/errors.ts`). Health returns 503. |
| Invalid filters / body | 400 with per-field details. |
| Duplicate idempotency key | 200 replay or 409 mismatch, as above. |
| Empty results | 200 with `data: []` / `total: 0` and zero-filled days; the UI shows an explicit empty state. |
| Unexpected errors | 500 with a generic message; details only in server logs. |

### Logging
- **pino + pino-http:** one JSON line per request with request id (incoming `x-request-id` accepted if safe, otherwise generated, always echoed), method, URL, status, latency, and `userId`/`orgId`/`role` once authenticated.
- **Never logged:** headers (including `Authorization`), request and response bodies, event metadata, passwords. Prisma error messages can echo query arguments, so for DB errors only the error name and code are logged. A redaction list backs this up.

---

## Indexes

| Index | Serves | Why it helps |
| --- | --- | --- |
| `(org_id, occurred_at DESC, id DESC)` | Main list, keyset pagination, date ranges, daily trend | Matches the `ORDER BY` exactly: a page is an index range scan that stops after `limit + 1` rows, with no sort. Covers the daily aggregation as an index-only scan. |
| `(org_id, event_type, occurred_at DESC, id DESC)` | `eventType` filter on the list; counts by type | Type-filtered pages stay ordered index scans; the per-type `GROUP BY` is index-only. |
| `(org_id, source, occurred_at DESC)` | `source` filter | Equality on source, then a time range within it. |
| `GIN (search_text gin_trgm_ops)` | `q` substring search | `LIKE '%…%'` can't use a B-tree; trigrams make it an index lookup. |
| `UNIQUE (org_id, idempotency_key)` | Idempotency | Enforces one event per key per org atomically (NULL keys never collide). |

Measured on the seed data (Acme, 30-day window):

```
list page (cursor)     Index Only Scan using events_org_occurred_idx          0.16 ms
counts by type         Index Only Scan using events_org_type_occurred_idx     0.40 ms
daily trend            Index Only Scan using events_org_occurred_idx          0.43 ms
search q=inv_0001      Bitmap Index Scan on events_search_text_trgm_idx
```

Every org-scoped index leads with `org_id`, so a tenant's queries touch only that tenant's slice of the index.

---

## A bug worth knowing about: timestamps and the session time zone

With Prisma 7's `@prisma/adapter-pg`, `DateTime` values are sent **without an offset**. On a Postgres server whose `TimeZone` isn't UTC (mine is `Asia/Karachi`), `2026-10-01T00:00Z` was stored as `2026-10-01 00:00+05`. Prisma reads it back with the opposite shift, so the API looked correct, but SQL-side date logic (daily buckets) was 5 hours off. The analytics tests caught it.

Fix: the connection pins `TimeZone=UTC` (`server/src/db/prisma.ts`), raw SQL passes explicit `…Z` instants cast to `timestamptz`, and a regression test asserts the stored UTC value directly. Columns are `timestamptz(3)` (millisecond precision, same as JS `Date`), so cursors round-trip exactly.

---

## Testing

```bash
npm test          # from the repo root
```

115 tests across 7 files, run against a real Postgres (`app_test`) and Redis (DB 1):

- **auth:** login success and failure, identical errors for unknown email vs wrong password, 401 for missing, malformed, expired, wrong-secret, `alg: none` and bad-claim tokens, 403 vs 401 in `requireRole`.
- **ingest:** 17 validation cases, client `orgId`/`tenantId` rejected, UTC normalisation, idempotent replay, key-order and offset equivalence, 409 mismatch, per-org key scope, 8-way concurrent race.
- **list:** tenant isolation (rows, filters, search, foreign cursor), ordering, full pagination walks with ties, stability under concurrent inserts, every filter, LIKE-wildcard escaping, 13 validation cases.
- **analytics:** exact aggregates with range-edge and UTC-bucketing cases, filters, consistency between sections, empty org, defaults, validation, cache hit/miss, cross-org cache isolation, per-dimension keys, invalidation on ingest, Redis-down fallback.
- **failures:** DB-unavailable → 503 mapping, cache helpers fail open, health `degraded`.

Each test file creates its own organisations (unique ids and emails) and deletes them afterwards, instead of truncating tables, so files run in parallel against one database without interfering.

The client was verified manually and with a headless-browser script (login error, dashboard filters, empty state, load more, search, 375 px width, session restore). There are no automated client tests.

---

## What I'd do next

1. **Row-Level Security** as a database-enforced backstop for tenant isolation.
2. **Refresh tokens / revocation**, an `httpOnly` cookie, and rate limiting on `/auth/login`.
3. **Idempotency-key expiry** (e.g. 72 h) and binding list cursors to their filters.
4. **Scale-out analytics:** daily rollup tables (or a materialised view) maintained on ingest, time-based partitioning of `events`, and an org-prefixed trigram index.
5. **Per-user time zones** for the daily trend (tz added to the cache key).
6. **OpenAPI spec** generated from the Zod schemas; client tests (Vitest + Testing Library); lazy-load Recharts (the client bundle is ~600 KB, mostly charts).
7. **Operational extras:** `helmet`, metrics (cache hit rate, p95 latency), and secrets from a secret manager.

## Conventions

- **Adding a feature:** create `server/src/modules/<name>/` with `schema` / `controller` / `service` / `repository` / `routes`, then mount it in `server/src/routes/index.ts`.
- **Migrations:** `npm --prefix server run db:migrate -- --name <change>` (dev). Note that `pg_trgm` and the metadata `CHECK` constraint were added to the init migration by hand.
