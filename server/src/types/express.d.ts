declare global {
  namespace Express {
    interface Request {
      /** Parsed + typed values set by the `validate` middleware. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
