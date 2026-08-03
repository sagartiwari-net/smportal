/**
 * Production fresh reset:
 * - Keep task library (isLibrary=true)
 * - Wipe interns, groups, invites, attendance, assignments, non-library tasks, extra users
 * - Create only the 5 staff accounts below
 *
 * Run on server:
 *   cd /www/wwwroot/sagartiwari.net/smm/backend
 *   CONFIRM=YES npx tsx prisma/reset-fresh-accounts.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/utils/password";

const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/smm_portal",
);
const prisma = new PrismaClient({ adapter });

const KEEP_EMAILS = [
  "master@sagartiwari.net",
  "admin@sagartiwari.net",
  "hr@sagartiwari.net",
  "trainer@sagartiwari.net",
  "hierank@sagartiwari.net",
] as const;

async function upsertUser(email: string, fullName: string, role: Role, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isActive: true },
    create: { email, fullName, role, passwordHash, isActive: true },
  });
}

async function main() {
  if (process.env.CONFIRM !== "YES") {
    console.error("Refusing to run. Set CONFIRM=YES to wipe operational data.");
    process.exit(1);
  }

  console.log("Starting fresh reset (keeping library tasks only)…");

  // 1) Create/refresh keep users FIRST so we can re-point library task creators
  const hierankCollege = await prisma.college.upsert({
    where: { name: "Hierank Business School" },
    update: { code: "HIERANK" },
    create: { name: "Hierank Business School", code: "HIERANK" },
  });

  const master = await upsertUser("master@sagartiwari.net", "Master Admin", Role.ADMIN, "master123");
  const admin = await upsertUser("admin@sagartiwari.net", "Admin", Role.ADMIN, "admin123");
  const hr = await upsertUser("hr@sagartiwari.net", "HR Admin", Role.HR, "hr123");
  const trainer = await upsertUser("trainer@sagartiwari.net", "Trainer", Role.TRAINER, "trainer123");
  const collegeTeacher = await upsertUser(
    "hierank@sagartiwari.net",
    "Hierank Teacher",
    Role.COLLEGE,
    "hierank123",
  );

  await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    update: {},
    create: { userId: trainer.id },
  });

  await prisma.collegeProfile.upsert({
    where: { userId: collegeTeacher.id },
    update: { collegeId: hierankCollege.id },
    create: { userId: collegeTeacher.id, collegeId: hierankCollege.id },
  });

  // 2) Clear dependent operational data (order matters for non-cascade FKs)
  await prisma.feedback.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.taskAssignment.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.profileChangeRequest.deleteMany({});

  // Invites reference groups/users — clear interns' invite links first via profile updates, then invites
  await prisma.internProfile.updateMany({
    data: {
      inviteId: null,
      registeredById: null,
      approvedById: null,
      completedById: null,
      hiredById: null,
    },
  });
  await prisma.registrationInvite.deleteMany({});
  await prisma.groupMember.deleteMany({});
  await prisma.groupTrainer.deleteMany({});

  // Non-library tasks go away; library stays (detach from groups)
  await prisma.task.deleteMany({ where: { isLibrary: false } });
  await prisma.task.updateMany({
    where: { isLibrary: true },
    data: { groupId: null, createdById: master.id },
  });

  await prisma.trainingGroup.deleteMany({});

  // 3) Delete all users except the 5 keep accounts
  const toDelete = await prisma.user.findMany({
    where: { email: { notIn: [...KEEP_EMAILS] } },
    select: { id: true, email: true, role: true },
  });
  console.log(`Deleting ${toDelete.length} other user(s)…`);

  // Clear remaining FK pointers that block user delete
  await prisma.feedback.deleteMany({}); // in case any left
  await prisma.attendance.updateMany({ data: { markedById: null } });

  // Intern/college/trainer profiles cascade with user; delete users in batches
  for (const u of toDelete) {
    await prisma.user.delete({ where: { id: u.id } });
  }

  // Ensure keep users have no stale intern profiles (none of the 5 should be INTERN)
  await prisma.internProfile.deleteMany({
    where: { userId: { in: [master.id, admin.id, hr.id, trainer.id, collegeTeacher.id] } },
  });

  const libraryCount = await prisma.task.count({ where: { isLibrary: true } });
  const userCount = await prisma.user.count();
  const internCount = await prisma.user.count({ where: { role: Role.INTERN } });
  const groupCount = await prisma.trainingGroup.count();

  console.log("\nFresh reset done.");
  console.log(`  Users left: ${userCount}`);
  console.log(`  Interns: ${internCount}`);
  console.log(`  Groups: ${groupCount}`);
  console.log(`  Library tasks kept: ${libraryCount}`);
  console.log("\nLogins:");
  console.log("  master@sagartiwari.net   → ADMIN   / master123");
  console.log("  admin@sagartiwari.net    → ADMIN   / admin123");
  console.log("  hr@sagartiwari.net       → HR      / hr123");
  console.log("  trainer@sagartiwari.net  → TRAINER / trainer123");
  console.log("  hierank@sagartiwari.net  → COLLEGE / hierank123  (Hierank Business School)");
  console.log("\nNext: Admin/HR invite link → Hierank teacher registers interns fresh.");
  void admin;
  void hr;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
