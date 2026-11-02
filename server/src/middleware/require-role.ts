import type { RequestHandler } from "express";
import type { Role } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

/** Use after `authenticate`: 401 if there is no user, 403 if their role isn't allowed. */
export const requireRole =
  (...allowed: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(HttpError.forbidden("Your role does not allow this action"));
    }
    next();
  };
