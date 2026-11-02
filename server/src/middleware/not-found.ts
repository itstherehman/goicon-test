import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};
