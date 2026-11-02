import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { loginBodySchema } from "./auth.schema.js";
import * as authController from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/login", validate({ body: loginBodySchema }), authController.login);
authRouter.get("/me", authenticate, authController.me);
