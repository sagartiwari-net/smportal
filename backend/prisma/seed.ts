import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/utils/password";

const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/smm_portal",
);

const prisma = new PrismaClient({ adapter });

async function upsertUser(data: {
  email: string;
  fullName: string;
  role: Role;
  password: string;
}) {
  const passwordHash = await hashPassword(data.password);
  return prisma.user.upsert({
    where: { email: data.email },
    update: {
      fullName: data.fullName,
      role: data.role,
      passwordHash,
      isActive: true,
    },
    create: {
      email: data.email,
      fullName: data.fullName,
      role: data.role,
      passwordHash,
    },
  });
}

async function main() {
  const college = await prisma.college.upsert({
    where: { name: "Demo College" },
    update: {},
    create: { name: "Demo College", code: "DEMO" },
  });

  await upsertUser({
    email: "master@sagartiwari.net",
    fullName: "Master Admin",
    role: Role.ADMIN,
    password: "master123",
  });

  const hrProd = await upsertUser({
    email: "hr@sagartiwari.net",
    fullName: "HR Admin",
    role: Role.HR,
    password: "hr123",
  });

  const trainerProd = await upsertUser({
    email: "trainer@sagartiwari.net",
    fullName: "Trainer",
    role: Role.TRAINER,
    password: "trainer123",
  });

  await prisma.trainerProfile.upsert({
    where: { userId: trainerProd.id },
    update: { phone: "9000000100" },
    create: { userId: trainerProd.id, phone: "9000000100" },
  });

  const student = await upsertUser({
    email: "student@sagartiwari.net",
    fullName: "Student Intern",
    role: Role.INTERN,
    password: "student123",
  });

  await prisma.internProfile.upsert({
    where: { userId: student.id },
    update: { collegeId: college.id, phone: "9000000101" },
    create: { userId: student.id, collegeId: college.id, phone: "9000000101" },
  });

  await upsertUser({
    email: "admin@smm.local",
    fullName: "Trusted Admin",
    role: Role.ADMIN,
    password: "password123",
  });

  const hr = await upsertUser({
    email: "hr@smm.local",
    fullName: "HR Admin",
    role: Role.HR,
    password: "password123",
  });

  const trainer = await upsertUser({
    email: "trainer@smm.local",
    fullName: "Demo Trainer",
    role: Role.TRAINER,
    password: "password123",
  });

  await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    update: {},
    create: { userId: trainer.id, phone: "9000000001" },
  });

  const intern = await upsertUser({
    email: "intern@smm.local",
    fullName: "Demo Intern",
    role: Role.INTERN,
    password: "password123",
  });

  await prisma.internProfile.upsert({
    where: { userId: intern.id },
    update: { collegeId: college.id },
    create: {
      userId: intern.id,
      collegeId: college.id,
      phone: "9000000002",
    },
  });

  const collegeUser = await upsertUser({
    email: "college@smm.local",
    fullName: "College Coordinator",
    role: Role.COLLEGE,
    password: "password123",
  });

  await prisma.collegeProfile.upsert({
    where: { userId: collegeUser.id },
    update: { collegeId: college.id },
    create: {
      userId: collegeUser.id,
      collegeId: college.id,
      phone: "9000000003",
    },
  });

  
  const group = await prisma.trainingGroup.upsert({
    where: { id: "seed-group-alpha" },
    update: { trainerId: trainer.id },
    create: {
      id: "seed-group-alpha",
      name: "Web Cohort Alpha",
      batchLabel: "July 2026",
      trainerId: trainer.id,
    },
  });

  await prisma.groupMember.updateMany({
    where: { internId: (await prisma.internProfile.findUnique({ where: { userId: intern.id } }))!.id, isActive: true },
    data: { isActive: false, leftAt: new Date() },
  });

  const internProfile = await prisma.internProfile.findUniqueOrThrow({ where: { userId: intern.id } });
  await prisma.groupMember.create({
    data: { groupId: group.id, internId: internProfile.id },
  });

  const today = new Date();
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  const existingTask = await prisma.task.findFirst({ where: { title: "Landing Page" } });
  if (!existingTask) {
    const task = await prisma.task.create({
      data: {
        title: "Landing Page",
        description: "Build a responsive landing page with HTML + CSS. Submit GitHub and live URL.",
        dueDate: d,
        groupId: group.id,
        createdById: trainer.id,
      },
    });
    await prisma.taskAssignment.create({
      data: {
        taskId: task.id,
        internId: internProfile.id,
        forDate: d,
        dayNumber: 1,
        taskNumber: 1,
      },
    });
  }

  await prisma.attendance.upsert({
    where: { internId_date: { internId: internProfile.id, date: d } },
    update: { status: "PRESENT", markedById: trainer.id },
    create: { internId: internProfile.id, date: d, status: "PRESENT", markedById: trainer.id },
  });

  console.log("Seed complete. Production logins:");
  console.log("  master@sagartiwari.net  → ADMIN   (master123)");
  console.log("  hr@sagartiwari.net      → HR      (hr123)");
  console.log("  trainer@sagartiwari.net → TRAINER (trainer123)");
  console.log("  student@sagartiwari.net → INTERN  (student123)");
  console.log("Demo logins (password: password123):");
  console.log("  admin@smm.local    → ADMIN");
  console.log("  hr@smm.local       → HR");
  console.log("  trainer@smm.local  → TRAINER");
  console.log("  intern@smm.local   → INTERN");
  console.log("  college@smm.local  → COLLEGE");
  console.log(`HR id: ${hr.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
