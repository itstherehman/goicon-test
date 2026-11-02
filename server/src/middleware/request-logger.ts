import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";

// Accept a caller-supplied request id only if it is short and harmless.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * One log line per request: id, method, url, status, latency.
 * Headers and bodies are deliberately not serialized.
 */
export const requestLogger = pinoHttp<Request, Response>({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  // Evaluated again when the response finishes, so it sees req.user set by `authenticate`.
  customProps: (req) => (req.user ? { userId: req.user.id, orgId: req.user.orgId, role: req.user.role } : {}),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
