/**
 * Production login accounts for smm.sagartiwari.net
 * Run: npm run db:seed-prod
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
    create: { email, fullName, role, passwordHash },
  });
}

async function main() {
  const college = await prisma.college.upsert({
    where: { name: "Demo College" },
    update: {},
    create: { name: "Demo College", code: "DEMO" },
  });

  const master = await upsertUser("master@sagartiwari.net", "Master Admin", Role.ADMIN, "master123");
  const hr = await upsertUser("hr@sagartiwari.net", "HR Admin", Role.HR, "hr123");
  const trainer = await upsertUser("trainer@sagartiwari.net", "Trainer", Role.TRAINER, "trainer123");
  const student = await upsertUser("student@sagartiwari.net", "Student Intern", Role.INTERN, "student123");

  await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    update: { phone: "9000000100" },
    create: { userId: trainer.id, phone: "9000000100" },
  });

  await prisma.internProfile.upsert({
    where: { userId: student.id },
    update: { collegeId: college.id, phone: "9000000101" },
    create: { userId: student.id, collegeId: college.id, phone: "9000000101" },
  });

  let group = await prisma.trainingGroup.findFirst({
    where: { trainerId: trainer.id, name: "Production Batch" },
  });
  if (!group) {
    group = await prisma.trainingGroup.create({
      data: {
        name: "Production Batch",
        batchLabel: "Live",
        trainerId: trainer.id,
        isActive: true,
      },
    });
  } else {
    await prisma.trainingGroup.update({
      where: { id: group.id },
      data: { trainerId: trainer.id, isActive: true },
    });
  }

  const studentProfile = await prisma.internProfile.findUniqueOrThrow({ where: { userId: student.id } });
  await prisma.groupMember.updateMany({
    where: { internId: studentProfile.id, isActive: true },
    data: { isActive: false, leftAt: new Date() },
  });
  await prisma.groupMember.create({
    data: { groupId: group.id, internId: studentProfile.id },
  });

  console.log("Production accounts ready:");
  console.log("  master@sagartiwari.net  → ADMIN   (master123)");
  console.log("  hr@sagartiwari.net      → HR      (hr123)");
  console.log("  trainer@sagartiwari.net → TRAINER (trainer123)");
  console.log("  student@sagartiwari.net → INTERN  (student123)");
  console.log(`Master id: ${master.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
