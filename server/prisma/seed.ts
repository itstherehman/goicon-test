/**
 * Dev seed: two organisations with an Admin and an Analyst each, plus ~90 days
 * of events. Sources are distinct per org so any cross-tenant leak is obvious.
 * Deterministic (seeded PRNG) and re-runnable: it replaces the seeded orgs' data.
 *
 * Run: npm run db:seed
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { EventType, Role, type Prisma } from "../src/generated/prisma/client.js";
import { buildSearchText } from "../src/modules/events/search-text.js";

const DEV_PASSWORD = "Password123!";
const DAYS = 90;
const BATCH_SIZE = 1000;

type SeedOrg = {
  id: string;
  name: string;
  domain: string;
  eventCount: number;
  sources: string[];
};

// Fixed ids so re-running the seed (and the README examples) stay stable.
const ORGS: SeedOrg[] = [
  {
    id: "0192f000-0000-7000-8000-00000000000a",
    name: "Acme Corp",
    domain: "acme.test",
    eventCount: 3000,
    sources: ["billing-service", "scheduler", "web-app"],
  },
  {
    id: "0192f000-0000-7000-8000-00000000000b",
    name: "Globex Inc",
    domain: "globex.test",
    eventCount: 2000,
    sources: ["payments-api", "etl-pipeline", "admin-portal"],
  },
];

// Mulberry32: tiny deterministic PRNG.
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Skewed so the "counts by type" chart isn't flat.
const TYPE_WEIGHTS: [EventType, number][] = [
  [EventType.job_completed, 40],
  [EventType.payment_succeeded, 25],
  [EventType.user_invited, 12],
  [EventType.job_failed, 10],
  [EventType.workflow_delayed, 8],
  [EventType.payment_failed, 5],
];
const TOTAL_WEIGHT = TYPE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);

function buildMetadata(type: EventType, n: number, random: () => number): Record<string, unknown> {
  const id = (prefix: string) => `${prefix}_${String(n).padStart(5, "0")}`;
  switch (type) {
    case EventType.job_completed:
      return { jobId: id("job"), durationMs: Math.round(200 + random() * 30000) };
    case EventType.job_failed:
      return { jobId: id("job"), error: random() < 0.5 ? "timeout" : "out_of_memory", attempt: 1 + Math.floor(random() * 3) };
    case EventType.payment_succeeded:
      return { invoiceId: id("inv"), amountCents: Math.round(500 + random() * 50000), currency: "USD" };
    case EventType.payment_failed:
      return { invoiceId: id("inv"), amountCents: Math.round(500 + random() * 50000), currency: "USD", reason: random() < 0.5 ? "card_declined" : "insufficient_funds" };
    case EventType.user_invited:
      return { inviteId: id("invite"), role: random() < 0.3 ? "admin" : "member" };
    case EventType.workflow_delayed:
      return { workflowId: id("wf"), delayMinutes: Math.round(5 + random() * 240), step: random() < 0.5 ? "approval" : "export" };
  }
}

function pickType(random: () => number): EventType {
  let roll = random() * TOTAL_WEIGHT;
  for (const [type, weight] of TYPE_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return EventType.job_completed;
}

function buildEvents(org: SeedOrg, now: Date, random: () => number): Prisma.EventCreateManyInput[] {
  const events: Prisma.EventCreateManyInput[] = [];
  const windowMs = DAYS * 24 * 60 * 60 * 1000;

  for (let n = 0; n < org.eventCount; n++) {
    const eventType = pickType(random);
    const source = org.sources[Math.floor(random() * org.sources.length)]!;
    const metadata = buildMetadata(eventType, n, random);
    // Squared random biases events towards recent days, so the trend has a slope.
    const occurredAt = new Date(now.getTime() - Math.floor(random() ** 2 * windowMs));

    events.push({
      orgId: org.id,
      eventType,
      occurredAt,
      source,
      metadata: metadata as Prisma.InputJsonObject,
      searchText: buildSearchText(eventType, source, metadata),
    });
  }

  return events;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const now = new Date();

  for (const [index, org] of ORGS.entries()) {
    await prisma.organization.deleteMany({ where: { id: org.id } }); // cascades users + events
    await prisma.organization.create({
      data: {
        id: org.id,
        name: org.name,
        users: {
          create: [
            { email: `admin@${org.domain}`, passwordHash, role: Role.ADMIN },
            { email: `analyst@${org.domain}`, passwordHash, role: Role.ANALYST },
          ],
        },
      },
    });

    const events = buildEvents(org, now, createRandom(index + 1));
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      await prisma.event.createMany({ data: events.slice(i, i + BATCH_SIZE) });
    }

    console.log(`Seeded ${org.name}: 2 users, ${events.length} events`);
  }

  console.log(`\nLogins (password "${DEV_PASSWORD}"):`);
  for (const org of ORGS) console.log(`  admin@${org.domain}  analyst@${org.domain}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
