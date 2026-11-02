# Feature modules

One folder per domain resource. Suggested layout:

```
modules/<name>/
  <name>.schema.ts      # Zod schemas for body/query/params + inferred types
  <name>.service.ts     # business logic + Prisma calls (no req/res)
  <name>.controller.ts  # maps HTTP <-> service, reads req.validated
  <name>.routes.ts      # Router: validate(...) + controller handlers
```

Then mount the router in `src/routes/index.ts`.
