import type { AuthUser } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      /** Parsed + typed values set by the `validate` middleware. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
        headers?: unknown;
      };
      /** Set by the `authenticate` middleware from a verified JWT. */
      user?: AuthUser;
    }
  }
}

export {};
