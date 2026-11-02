import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../utils/http-error.js";

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

/**
 * Validates req.body / req.query / req.params against Zod schemas.
 * Parsed values are exposed on `req.validated` (Express 5 makes req.query read-only).
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const validated: NonNullable<typeof req.validated> = {};
    const issues: { location: string; path: string; message: string }[] = [];

    for (const location of ["params", "query", "body"] as const) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join("."), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      return next(HttpError.badRequest("Validation failed", issues));
    }

    req.validated = validated;
    next();
  };
