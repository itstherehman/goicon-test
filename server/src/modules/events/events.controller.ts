import type { RequestHandler } from "express";
import type { CreateEventBody, IngestHeaders, ListEventsQuery } from "./events.schema.js";
import * as eventsService from "./events.service.js";

export const createEvent: RequestHandler = async (req, res) => {
  const body = req.validated!.body as CreateEventBody;
  const headers = req.validated!.headers as IngestHeaders;

  const { event, replayed } = await eventsService.ingestEvent(req.user!.orgId, body, headers["idempotency-key"]);

  req.log.info({ eventId: event.id, eventType: event.eventType, replayed }, "event ingested");
  if (replayed) res.setHeader("Idempotent-Replayed", "true");
  res.status(replayed ? 200 : 201).json({ data: event });
};

export const listEvents: RequestHandler = async (req, res) => {
  const query = req.validated!.query as ListEventsQuery;
  res.json(await eventsService.listEvents(req.user!.orgId, query));
};
