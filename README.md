# App

Full-stack TypeScript starter: **Express 5 + Prisma 7 (PostgreSQL) + Zod** API and a **React 19 + Vite** client.

## Stack & why

| Layer      | Choice                         | Reason                                                        |
| ---------- | ------------------------------ | ------------------------------------------------------------- |
| API        | Express 5 + TypeScript         | Minimal, well known; Express 5 forwards async errors natively |
| Validation | Zod                            | One schema gives runtime validation + inferred TS types       |
| DB / ORM   | PostgreSQL + Prisma 7 (pg adapter) | Typed queries, migrations in source control               |
| Tests      | Vitest + Supertest             | Fast, run against a real test database                        |
| Client     | React + Vite                   | Fast dev server; `/api` is proxied to the API                 |

## Project layout

```
server/
  prisma/schema.prisma        # data model (add models here)
  prisma.config.ts            # Prisma CLI config (.env / .env.test)
  src/
    app.ts                    # createApp(): middleware, routes, error handling
    server.ts                 # starts HTTP server, graceful shutdown
    config/env.ts             # Zod-validated environment variables
    db/prisma.ts              # Prisma client singleton
    middleware/
      validate.ts             # validate({ body, query, params }) -> req.validated
      error-handler.ts        # all errors -> { error: { code, message, details? } }
      not-found.ts
    utils/http-error.ts       # HttpError.badRequest() / notFound() / ...
    routes/index.ts           # mounts feature routers under /api
    modules/                  # feature modules (see modules/README.md)
  tests/                      # Vitest + Supertest
client/
  src/lib/api.ts              # fetch wrapper that throws ApiError
  src/components/             # UI components
  src/App.tsx
```

## Setup

Prerequisites: Node 20+ and a local PostgreSQL.

```bash
npm run install:all
```

Create the databases (names match `server/.env` and `server/.env.test`):

```bash
createdb app_dev
createdb app_test
```

Copy and edit the env file if your Postgres user/password differs:

```bash
cp server/.env.example server/.env
```

Once models exist in `server/prisma/schema.prisma`, create and apply a migration:

```bash
npm --prefix server run db:migrate -- --name init
```

## Running

```bash
npm run dev
```

- API: http://localhost:4000/api
- Client: http://localhost:5173 (proxies `/api` to the API)

## Tests

```bash
npm test
```

Applies migrations to `app_test`, then runs Vitest.

## Conventions

**Error shape** (every non-2xx response):

```json
{ "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": [ { "location": "body", "path": "name", "message": "..." } ] } }
```

**Adding a feature**: create `src/modules/<name>/` with `schema` / `service` / `controller` / `routes`, then mount the router in `src/routes/index.ts`.

## Example requests

```bash
curl http://localhost:4000/api/health
# {"status":"ok","db":"up"}
```

## Auth (production notes)

Not implemented here. For production I would add:

- Authentication: JWT (or session cookie) via an identity provider (Auth0/Cognito/Clerk), verified in an `authenticate` middleware that sets `req.user`.
- Authorization: role/membership checks per resource (e.g. only members of a workspace can read/write its data) in an `authorize` middleware or the service layer.
- Hardening: `helmet`, rate limiting, strict CORS origins, request logging with request IDs, and secrets from a secret manager.
