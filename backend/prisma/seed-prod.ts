/**
 * Upsert production staff accounts (does NOT wipe data).
 * For full wipe + keep library: CONFIRM=YES npm run db:reset-fresh
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/utils/password";

const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/smm_portal",
);
const prisma = new PrismaClient({ adapter });

async function upsertUser(email: string, fullName: string, role: Role, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isActive: true },
    create: { email, fullName, role, passwordHash, isActive: true },
  });
}

async function main() {
  const hierank = await prisma.college.upsert({
    where: { name: "Hierank Business School" },
    update: { code: "HIERANK" },
    create: { name: "Hierank Business School", code: "HIERANK" },
  });

  await upsertUser("master@sagartiwari.net", "Master Admin", Role.ADMIN, "master123");
  await upsertUser("admin@sagartiwari.net", "Admin", Role.ADMIN, "admin123");
  await upsertUser("hr@sagartiwari.net", "HR Admin", Role.HR, "hr123");
  const trainer = await upsertUser("trainer@sagartiwari.net", "Trainer", Role.TRAINER, "trainer123");
  const college = await upsertUser("hierank@sagartiwari.net", "Hierank Teacher", Role.COLLEGE, "hierank123");

  await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    update: {},
    create: { userId: trainer.id },
  });
  await prisma.collegeProfile.upsert({
    where: { userId: college.id },
    update: { collegeId: hierank.id },
    create: { userId: college.id, collegeId: hierank.id },
  });

  console.log("Production staff accounts ready:");
  console.log("  master@sagartiwari.net   ADMIN    master123");
  console.log("  admin@sagartiwari.net    ADMIN    admin123");
  console.log("  hr@sagartiwari.net       HR       hr123");
  console.log("  trainer@sagartiwari.net  TRAINER  trainer123");
  console.log("  hierank@sagartiwari.net  COLLEGE  hierank123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
