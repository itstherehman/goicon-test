# Feature modules

One folder per domain resource. Suggested layout:

```
modules/<name>/
  <name>.schema.ts      # Zod schemas for body/query/params/headers + inferred types
  <name>.repository.ts  # data access (Prisma/SQL); tenant-scoped functions take orgId first
  <name>.service.ts     # business logic, caching (no req/res, no Prisma)
  <name>.controller.ts  # maps HTTP <-> service, reads req.validated and req.user
  <name>.routes.ts      # Router: authenticate, requireRole(...), validate(...), controller
```

Then mount the router in `src/routes/index.ts`.
