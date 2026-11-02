import { Router } from "express";
import { healthRouter } from "./health.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);

// Mount feature modules here, e.g.:
// apiRouter.use("/things", thingsRouter);
