import { Router } from "express";
import { Role } from "../../generated/prisma/client.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";
import { validate } from "../../middleware/validate.js";
import { createEventBodySchema, ingestHeadersSchema, listEventsQuerySchema } from "./events.schema.js";
import * as eventsController from "./events.controller.js";

export const eventsRouter = Router();

eventsRouter.use(authenticate);

eventsRouter.post(
  "/",
  requireRole(Role.ADMIN),
  validate({ body: createEventBodySchema, headers: ingestHeadersSchema }),
  eventsController.createEvent,
);

eventsRouter.get(
  "/",
  requireRole(Role.ADMIN, Role.ANALYST),
  validate({ query: listEventsQuerySchema }),
  eventsController.listEvents,
);
