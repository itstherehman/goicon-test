import type { ErrorRequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { env } from "../config/env.js";

/**
 * Single place that turns errors into the API's error shape:
 * { error: { code, message, details? } }
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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

  if (env.NODE_ENV !== "test") console.error(err);

  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
};
