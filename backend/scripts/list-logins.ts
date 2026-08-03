import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/smm_portal",
);
const prisma = new PrismaClient({ adapter });

async function main() {
  const trainers = await prisma.user.findMany({
    where: { role: "TRAINER", isActive: true },
    include: { trainedGroups: true },
  });
  console.log("===TRAINERS===");
  for (const t of trainers) {
    const groups = t.trainedGroups.filter((g) => g.isActive).map((g) => g.name);
    console.log(`${t.email}|${t.fullName}|${groups.join(", ") || "(none)"}`);
  }

  const colleges = await prisma.user.findMany({
    where: { role: "COLLEGE", isActive: true },
    include: { collegeProfile: { include: { college: true } } },
  });
  console.log("===COLLEGE===");
  for (const c of colleges) {
    console.log(`${c.email}|${c.fullName}|${c.collegeProfile?.college?.name || "(none)"}`);
  }

  const interns = await prisma.user.findMany({
    where: { role: "INTERN", isActive: true },
    include: {
      internProfile: {
        include: {
          college: true,
          memberships: { where: { isActive: true }, include: { group: true } },
        },
      },
    },
    orderBy: { email: "asc" },
  });
  console.log("===INTERNS===");
  for (const i of interns) {
    const p = i.internProfile;
    const g = p?.memberships?.[0]?.group?.name || "(none)";
    console.log(`${i.email}|${i.fullName}|${p?.college?.name || "(none)"}|${g}`);
  }

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true, fullName: true },
  });
  console.log("===ADMINS===");
  for (const a of admins) console.log(`${a.email}|${a.fullName}`);

  const hrs = await prisma.user.findMany({
    where: { role: "HR", isActive: true },
    select: { email: true, fullName: true },
  });
  console.log("===HRS===");
  for (const h of hrs) console.log(`${h.email}|${h.fullName}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
