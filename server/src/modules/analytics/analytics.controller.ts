import type { RequestHandler } from "express";
import type { SummaryQuery } from "./analytics.schema.js";
import * as analyticsService from "./analytics.service.js";

export const getSummary: RequestHandler = async (req, res) => {
  const query = req.validated!.query as SummaryQuery;
  const { summary, cacheHit } = await analyticsService.getSummary(req.user!.orgId, query);

  res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
  res.json({ data: summary });
};
