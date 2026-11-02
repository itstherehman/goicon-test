import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/jwt.js";
import { HttpError } from "../utils/http-error.js";

/**
 * Requires `Authorization: Bearer <jwt>` and sets `req.user`.
 * The organisation always comes from the verified token, never from the request.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  const [scheme, token, ...rest] = (req.headers.authorization ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return next(HttpError.unauthorized("Missing or malformed bearer token"));
  }

  const user = await verifyAccessToken(token);
  if (!user) {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    return next(HttpError.unauthorized("Invalid or expired token"));
  }

  req.user = user;
  next();
};
