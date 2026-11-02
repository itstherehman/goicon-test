import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { authenticate } from "../src/middleware/authenticate.js";
import { requireRole } from "../src/middleware/require-role.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { Role } from "../src/generated/prisma/client.js";
import { createTestOrg, deleteTestOrgs, TEST_PASSWORD, type TestOrg } from "./helpers/fixtures.js";

const app = createApp();
let acme: TestOrg;

beforeAll(async () => {
  acme = await createTestOrg("Acme");
});

afterAll(async () => {
  await deleteTestOrgs(acme);
});

describe("POST /api/auth/login", () => {
  it("returns a token and profile for valid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: acme.admin.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      expiresIn: env.JWT_TTL_SECONDS,
      user: { id: acme.admin.id, email: acme.admin.email, role: "ADMIN", organization: { id: acme.org.id } },
    });
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(acme.admin.id);
  });

  it("treats email case-insensitively", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `  ${acme.analyst.email.toUpperCase()} `, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("ANALYST");
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(app).post("/api/auth/login").send({ email: acme.admin.email, password: "nope" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: TEST_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "email" }),
        expect.objectContaining({ path: "password" }),
      ]),
    );
  });
});

describe("authenticate middleware", () => {
  const me = () => request(app).get("/api/auth/me");

  it("returns 401 without an Authorization header", async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it.each([
    ["non-bearer scheme", "Basic abc"],
    ["missing token", "Bearer"],
    ["extra parts", "Bearer a b"],
    ["garbage token", "Bearer not.a.jwt"],
  ])("returns 401 for a %s", async (_label, header) => {
    const res = await me().set("Authorization", header);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const token = await signAccessToken({ id: acme.admin.id, orgId: acme.org.id, role: Role.ADMIN }, -10);

    const res = await me().set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/);
  });

  it("returns 401 for a token signed with another secret", async () => {
    const token = await new SignJWT({ orgId: acme.org.id, role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(acme.admin.id)
      .setIssuer("ops-analytics")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("x".repeat(32)));

    const res = await me().set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unsigned (alg: none) token", async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none" })}.${encode({ sub: acme.admin.id, orgId: acme.org.id, role: "ADMIN", iss: "ops-analytics" })}.`;

    const res = await me().set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a validly signed token with an unexpected claim shape", async () => {
    const token = await new SignJWT({ orgId: acme.org.id, role: "SUPERUSER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(acme.admin.id)
      .setIssuer("ops-analytics")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.JWT_SECRET));

    const res = await me().set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe("requireRole middleware", () => {
  // Throwaway app so role checks are tested independently of any feature route.
  const roleApp = express();
  roleApp.post("/admin-only", authenticate, requireRole(Role.ADMIN), (_req, res) => {
    res.status(204).end();
  });
  roleApp.use(errorHandler);

  it("allows a permitted role", async () => {
    const res = await request(roleApp).post("/admin-only").set("Authorization", `Bearer ${acme.adminToken}`);
    expect(res.status).toBe(204);
  });

  it("returns 403 for an authenticated user without the role", async () => {
    const res = await request(roleApp).post("/admin-only").set("Authorization", `Bearer ${acme.analystToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 (not 403) when unauthenticated", async () => {
    const res = await request(roleApp).post("/admin-only");
    expect(res.status).toBe(401);
  });
});
