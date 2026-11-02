export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new HttpError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Unauthorized") {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden") {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new HttpError(404, "NOT_FOUND", message);
  }

  static conflict(message = "Conflict", details?: unknown) {
    return new HttpError(409, "CONFLICT", message, details);
  }
}
