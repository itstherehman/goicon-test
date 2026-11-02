import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { validate } from "../src/middleware/validate.js";
import { errorHandler } from "../src/middleware/error-handler.js";

// Throwaway app to exercise the validate middleware in isolation.
const app = express();
app.use(express.json());
app.post(
  "/echo/:id",
  validate({
    params: z.object({ id: z.uuid() }),
    body: z.object({ name: z.string().min(1) }),
  }),
  (req, res) => res.json(req.validated),
);
app.use(errorHandler);

describe("validate middleware", () => {
  it("passes parsed values through on valid input", async () => {
    const id = "6f1c2c1e-8a4f-4c3e-9d6b-2a1f0b7e9c11";
    const res = await request(app).post(`/echo/${id}`).send({ name: "x" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id }, body: { name: "x" } });
  });

  it("returns 400 with per-field details on invalid input", async () => {
    const res = await request(app).post("/echo/not-a-uuid").send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "params", path: "id" }),
        expect.objectContaining({ location: "body", path: "name" }),
      ]),
    );
  });
});
