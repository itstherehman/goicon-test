import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("app", () => {
  it("GET /api/health reports API and DB status", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "up", redis: "up" });
  });

  it("returns a consistent 404 error for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await request(app)
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE for oversized bodies", async () => {
    const res = await request(app)
      .post("/api/health")
      .send({ blob: "x".repeat(70 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("echoes a safe x-request-id and generates one otherwise", async () => {
    const echoed = await request(app).get("/api/health").set("x-request-id", "abc-123");
    expect(echoed.headers["x-request-id"]).toBe("abc-123");

    const generated = await request(app).get("/api/health").set("x-request-id", "bad id <script>");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
