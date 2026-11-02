import { afterAll } from "vitest";
import { prisma } from "../src/db/prisma.js";

afterAll(async () => {
  await prisma.$disconnect();
});
