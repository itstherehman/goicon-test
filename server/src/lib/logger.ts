import { pino } from "pino";
import { env } from "../config/env.js";

/**
 * Structured JSON logger. Request bodies are never logged (see request-logger),
 * and the redact list is a second line of defence for secrets.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.metadata",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
});
