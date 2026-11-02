import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/db/prisma.js";
import { EventType, Role, type Prisma } from "../../src/generated/prisma/client.js";
import { signAccessToken } from "../../src/lib/jwt.js";
import { buildSearchText } from "../../src/modules/events/search-text.js";

export const TEST_PASSWORD = "Test-password-1";
// Low cost keeps tests fast; production hashes use cost 10.
const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 4);

export type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

/**
 * Each test file creates its own orgs (unique ids/emails) instead of truncating tables,
 * so files can run in parallel against one test database without interfering.
 */
export async function createTestOrg(label = "Org") {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `${label} ${suffix}` } });

  const [admin, analyst] = await Promise.all(
    [Role.ADMIN, Role.ANALYST].map((role) =>
      prisma.user.create({
        data: { orgId: org.id, email: `${role.toLowerCase()}-${suffix}@test.local`, passwordHash, role },
      }),
    ),
  );

  const [adminToken, analystToken] = await Promise.all([
    signAccessToken({ id: admin!.id, orgId: org.id, role: Role.ADMIN }),
    signAccessToken({ id: analyst!.id, orgId: org.id, role: Role.ANALYST }),
  ]);

  return { org, admin: admin!, analyst: analyst!, adminToken, analystToken };
}

export async function deleteTestOrgs(...orgs: TestOrg[]) {
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.org.id) } } });
}

export type EventSeed = {
  eventType?: EventType;
  occurredAt: string;
  source?: string;
  metadata?: Record<string, string | number>;
};

/** Inserts events directly (bypassing the API) so list/analytics tests control exact data. */
export async function insertEvents(orgId: string, events: EventSeed[]) {
  const data = events.map((e): Prisma.EventCreateManyInput => {
    const eventType = e.eventType ?? EventType.job_completed;
    const source = e.source ?? "scheduler";
    const metadata = e.metadata ?? {};
    return {
      orgId,
      eventType,
      occurredAt: new Date(e.occurredAt),
      source,
      metadata,
      searchText: buildSearchText(eventType, source, metadata),
    };
  });
  await prisma.event.createMany({ data });
}
