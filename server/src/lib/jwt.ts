import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../config/env.js";
import { Role } from "../generated/prisma/client.js";

export type AuthUser = {
  id: string;
  orgId: string;
  role: Role;
};

const ALGORITHM = "HS256";
const ISSUER = "ops-analytics";
const secret = new TextEncoder().encode(env.JWT_SECRET);

const claimsSchema = z.object({
  sub: z.uuid(),
  orgId: z.uuid(),
  role: z.enum(Role),
});

export async function signAccessToken(user: AuthUser, ttlSeconds = env.JWT_TTL_SECONDS): Promise<string> {
  return new SignJWT({ orgId: user.orgId, role: user.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

/** Returns the user for a valid token, or null for anything else (bad signature, expired, wrong shape). */
export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return { id: claims.data.sub, orgId: claims.data.orgId, role: claims.data.role };
  } catch {
    return null;
  }
}
