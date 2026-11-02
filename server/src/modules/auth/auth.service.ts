import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { signAccessToken, type AuthUser } from "../../lib/jwt.js";
import { HttpError } from "../../utils/http-error.js";
import type { LoginBody } from "./auth.schema.js";

// Compared against when the email is unknown, so both failure paths cost one bcrypt check
// and response timing doesn't reveal which emails exist.
const DUMMY_HASH = "$2b$10$mEHocxApwl.VR11ch5bvuu/bbygcziUpEJhmdSt8SVqomCoxT/gvC";

const profileSelect = {
  id: true,
  email: true,
  role: true,
  organization: { select: { id: true, name: true } },
} as const;

export async function login({ email, password }: LoginBody) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...profileSelect, orgId: true, passwordHash: true },
  });

  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw HttpError.unauthorized("Invalid email or password");

  const token = await signAccessToken({ id: user.id, orgId: user.orgId, role: user.role });
  const { passwordHash: _passwordHash, orgId: _orgId, ...profile } = user;
  return { token, expiresIn: env.JWT_TTL_SECONDS, user: profile };
}

export async function getProfile(authUser: AuthUser) {
  // Scoped by org too: a token whose org no longer matches the user is treated as invalid.
  const user = await prisma.user.findFirst({
    where: { id: authUser.id, orgId: authUser.orgId },
    select: profileSelect,
  });
  if (!user) throw HttpError.unauthorized("User no longer exists");
  return user;
}
