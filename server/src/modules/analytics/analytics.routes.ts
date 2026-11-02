import { Router } from "express";
import { Role } from "../../generated/prisma/client.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";
import { validate } from "../../middleware/validate.js";
import { summaryQuerySchema } from "./analytics.schema.js";
import * as analyticsController from "./analytics.controller.js";

export const analyticsRouter = Router();

analyticsRouter.get(
  "/summary",
  authenticate,
  requireRole(Role.ADMIN, Role.ANALYST),
  validate({ query: summaryQuerySchema }),
  analyticsController.getSummary,
);
