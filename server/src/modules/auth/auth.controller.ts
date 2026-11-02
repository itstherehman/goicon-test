import type { RequestHandler } from "express";
import type { LoginBody } from "./auth.schema.js";
import * as authService from "./auth.service.js";

export const login: RequestHandler = async (req, res) => {
  const body = req.validated!.body as LoginBody;
  res.json(await authService.login(body));
};

export const me: RequestHandler = async (req, res) => {
  res.json({ user: await authService.getProfile(req.user!) });
};
