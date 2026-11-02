import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

// Pin the session timezone to UTC. The pg adapter sends DateTime values without an offset,
// so on a server whose default TimeZone isn't UTC, stored instants would silently shift
// (and SQL-side date bucketing would disagree with what Prisma reads back).
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, options: "-c TimeZone=UTC" });

export const prisma = new PrismaClient({ adapter });
