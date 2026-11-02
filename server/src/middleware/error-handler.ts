import type { ErrorRequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { isDbUnavailable, isPrismaError } from "../db/errors.js";
import { logger } from "../lib/logger.js";

/**
 * Single place that turns errors into the API's error shape:
 * { error: { code, message, details? } }
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Malformed JSON body from express.json()
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON" },
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" },
    });
  }

  const log = req.log ?? logger;

  if (isDbUnavailable(err)) {
    log.error({ err: { name: err.name, code: err.code } }, "database unavailable");
    return res.status(503).json({
      error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" },
    });
  }

  // Prisma messages can echo query arguments (e.g. event metadata), so only log name/code.
  if (isPrismaError(err)) {
    log.error({ err: { name: err.name, code: err.code } }, "database error");
  } else {
    log.error({ err }, "unhandled error");
  }

  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
};
