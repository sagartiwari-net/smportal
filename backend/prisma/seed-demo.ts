/**
 * Rich fake data for analytics / reports testing.
 * Run: npm run db:seed-demo
 * Keeps core logins: admin/hr/trainer/intern/college @smm.local (password123)
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  AttendanceStatus,
  PrismaClient,
  Role,
  TaskStatus,
} from "../src/generated/prisma/client";
import { hashPassword } from "../src/utils/password";

const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/smm_portal",
);
const prisma = new PrismaClient({ adapter });

function daysBack(n: number) {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Deterministic pseudo-random 0..n-1 from string */
function hashMod(s: string, n: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

async function upsertUser(email: string, fullName: string, role: Role, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isActive: true },
    create: { email, fullName, role, passwordHash },
  });
}

const FIRST = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
  "Krishna", "Ishaan", "Ananya", "Aadhya", "Diya", "Myra", "Sara", "Ira",
  "Kabir", "Rohan", "Neha", "Pooja", "Kunal", "Riya", "Dev", "Nisha",
];
const LAST = ["Sharma", "Patel", "Singh", "Gupta", "Verma", "Khan", "Reddy", "Mehta", "Joshi", "Nair"];

async function main() {
  console.log("Seeding rich demo data…");

  const colleges = await Promise.all(
    [
      { name: "Demo College", code: "DEMO" },
      { name: "Hierank Business School", code: "HBS" },
      { name: "Tech Institute Delhi", code: "TID" },
      { name: "Sunrise Institute", code: "SRI" },
    ].map((c) =>
      prisma.college.upsert({
        where: { name: c.name },
        update: { code: c.code },
        create: c,
      }),
    ),
  );

  await upsertUser("admin@smm.local", "Trusted Admin", Role.ADMIN, "password123");
  await upsertUser("hr@smm.local", "HR Admin", Role.HR, "password123");
  const trainer = await upsertUser("trainer@smm.local", "Demo Trainer", Role.TRAINER, "password123");
  await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    update: {},
    create: { userId: trainer.id, phone: "9000000001" },
  });

  const collegeUser = await upsertUser(
    "college@smm.local",
    "College Coordinator",
    Role.COLLEGE,
    "password123",
  );
  await prisma.collegeProfile.upsert({
    where: { userId: collegeUser.id },
    update: { collegeId: colleges[0].id },
    create: { userId: collegeUser.id, collegeId: colleges[0].id, phone: "9000000003" },
  });

  const groupDefs = [
    { name: "Frontend Batch A", batchLabel: "July W1", id: "demo-group-fe-a" },
    { name: "Backend 1", batchLabel: "July W2", id: "demo-group-be-1" },
    { name: "Fullstack Mix", batchLabel: "July W3", id: "demo-group-fs" },
    { name: "UI/UX Batch B", batchLabel: "July W4", id: "demo-group-ux" },
  ];
  const groups = [];
  for (const g of groupDefs) {
    const row = await prisma.trainingGroup.upsert({
      where: { id: g.id },
      update: { name: g.name, batchLabel: g.batchLabel, trainerId: trainer.id, isActive: true },
      create: {
        id: g.id,
        name: g.name,
        batchLabel: g.batchLabel,
        trainerId: trainer.id,
        isActive: true,
      },
    });
    groups.push(row);
  }

  // Also attach any leftover groups named Backend 1 etc. to this trainer
  await prisma.trainingGroup.updateMany({
    where: { name: { in: groupDefs.map((g) => g.name) } },
    data: { trainerId: trainer.id, isActive: true },
  });

  const internProfiles: { profile: { id: string }; groupIndex: number; quality: number; email: string }[] = [];

  for (let i = 0; i < 24; i++) {
    const email = `intern${i + 1}@smm.local`;
    const fullName = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
    const college = colleges[i % colleges.length];
    const user = await upsertUser(email, fullName, Role.INTERN, "password123");
    const profile = await prisma.internProfile.upsert({
      where: { userId: user.id },
      update: { collegeId: college.id, phone: `98${String(10000000 + i).slice(0, 8)}` },
      create: {
        userId: user.id,
        collegeId: college.id,
        phone: `98${String(10000000 + i).slice(0, 8)}`,
      },
    });
    internProfiles.push({
      profile,
      groupIndex: i % groups.length,
      quality: i % 5,
      email,
    });
  }

  const demoInternUser = await upsertUser("intern@smm.local", "Demo Intern", Role.INTERN, "password123");
  const demoIntern = await prisma.internProfile.upsert({
    where: { userId: demoInternUser.id },
    update: { collegeId: colleges[0].id },
    create: { userId: demoInternUser.id, collegeId: colleges[0].id, phone: "9000000002" },
  });
  // Mid-tier so they have some absents + incomplete tasks (realistic self-view)
  internProfiles.push({ profile: demoIntern, groupIndex: 1, quality: 2, email: "intern@smm.local" });

  for (const { profile, groupIndex } of internProfiles) {
    await prisma.groupMember.updateMany({
      where: { internId: profile.id, isActive: true },
      data: { isActive: false, leftAt: new Date() },
    });
    await prisma.groupMember.create({
      data: { groupId: groups[groupIndex].id, internId: profile.id },
    });
  }

  // Attendance — 22 days: Sundays + some random weekdays as week-off; absents/leaves by quality
  const ATT_DAYS = 22;
  for (const { profile, quality, email } of internProfiles) {
    for (let back = 0; back < ATT_DAYS; back++) {
      const date = daysBack(back);
      const dow = date.getUTCDay();
      const key = `${profile.id}:${back}`;
      let status: AttendanceStatus;

      if (dow === 0) {
        status = AttendanceStatus.WEEK_OFF;
      } else if (hashMod(`${key}:wo`, 11) === 0) {
        // ~1/11 weekdays → random mid-week week-off
        status = AttendanceStatus.WEEK_OFF;
      } else {
        const roll = hashMod(`${key}:st`, 10);
        if (quality >= 3 && roll <= 1) status = AttendanceStatus.ABSENT;
        else if (quality >= 2 && roll === 2) status = AttendanceStatus.LEAVE;
        else if (quality === 2 && roll === 3 && email === "intern@smm.local") status = AttendanceStatus.ABSENT;
        else if (quality >= 4 && roll <= 3) status = AttendanceStatus.ABSENT;
        else status = AttendanceStatus.PRESENT;
      }

      await prisma.attendance.upsert({
        where: { internId_date: { internId: profile.id, date } },
        update: { status, markedById: trainer.id },
        create: { internId: profile.id, date, status, markedById: trainer.id },
      });
    }
  }

  const taskSpecs = [
    { title: "Landing Page", description: "Responsive landing page with HTML + CSS only." },
    { title: "Zomato Clone", description: "Homepage clone with custom CSS and vanilla JS." },
    { title: "Todo App", description: "Todo list with localStorage and filters." },
    { title: "Student CRUD", description: "Vanilla JS student management with search." },
    { title: "API Fetch Gallery", description: "Fetch public API and render cards." },
    { title: "Portfolio Site", description: "Personal portfolio with sections and contact form." },
  ];

  const libraryTasks = [];
  for (const spec of taskSpecs) {
    let task = await prisma.task.findFirst({ where: { title: spec.title, isLibrary: true } });
    if (!task) {
      task = await prisma.task.create({
        data: { ...spec, isLibrary: true, createdById: trainer.id },
      });
    }
    libraryTasks.push(task);
  }

  const assignDates = [daysBack(12), daysBack(10), daysBack(8), daysBack(5), daysBack(3), daysBack(1)];

  for (let ti = 0; ti < libraryTasks.length; ti++) {
    const task = libraryTasks[ti];
    const forDate = assignDates[ti];
    for (const { profile, quality } of internProfiles) {
      const existing = await prisma.taskAssignment.findUnique({
        where: { taskId_internId: { taskId: task.id, internId: profile.id } },
      });
      if (existing) {
        // Refresh status mix so re-seed updates reports
        let status: TaskStatus = TaskStatus.ASSIGNED;
        const r = (ti + quality) % 6;
        if (quality <= 1) status = r < 5 ? TaskStatus.DONE : TaskStatus.SUBMITTED;
        else if (quality === 2) status = r < 2 ? TaskStatus.DONE : r < 4 ? TaskStatus.SUBMITTED : TaskStatus.ASSIGNED;
        else if (quality === 3) status = r < 1 ? TaskStatus.DONE : r < 3 ? TaskStatus.NEEDS_IMPROVEMENT : TaskStatus.ASSIGNED;
        else status = r === 0 ? TaskStatus.SUBMITTED : TaskStatus.ASSIGNED;

        await prisma.taskAssignment.update({
          where: { id: existing.id },
          data: { status, forDate, dayNumber: ti + 1, taskNumber: 1 },
        });
        continue;
      }

      const priorDates = await prisma.taskAssignment.findMany({
        where: { internId: profile.id },
        select: { forDate: true, dayNumber: true, taskNumber: true },
      });
      const key = forDate.toISOString().slice(0, 10);
      const same = priorDates.filter((p) => p.forDate.toISOString().slice(0, 10) === key);
      let dayNumber = 1;
      let taskNumber = 1;
      if (same.length) {
        dayNumber = same[0].dayNumber;
        taskNumber = Math.max(...same.map((s) => s.taskNumber)) + 1;
      } else {
        const uniq = [...new Set(priorDates.map((p) => p.forDate.toISOString().slice(0, 10)))].sort();
        dayNumber = [...uniq, key].sort().indexOf(key) + 1;
      }

      let status: TaskStatus = TaskStatus.ASSIGNED;
      const r = (ti + quality) % 6;
      if (quality <= 1) status = r < 5 ? TaskStatus.DONE : TaskStatus.SUBMITTED;
      else if (quality === 2) status = r < 2 ? TaskStatus.DONE : r < 4 ? TaskStatus.SUBMITTED : TaskStatus.ASSIGNED;
      else if (quality === 3) status = r < 1 ? TaskStatus.DONE : r < 3 ? TaskStatus.NEEDS_IMPROVEMENT : TaskStatus.ASSIGNED;
      else status = r === 0 ? TaskStatus.SUBMITTED : TaskStatus.ASSIGNED;

      const assignment = await prisma.taskAssignment.create({
        data: {
          taskId: task.id,
          internId: profile.id,
          forDate,
          dayNumber,
          taskNumber,
          status,
        },
      });

      if (status === TaskStatus.DONE || status === TaskStatus.SUBMITTED || status === TaskStatus.NEEDS_IMPROVEMENT) {
        const sub = await prisma.submission.create({
          data: {
            assignmentId: assignment.id,
            projectDetails: `Demo submission for ${task.title} by intern.`,
            githubUrl: `https://github.com/demo/${task.title.toLowerCase().replace(/\s+/g, "-")}`,
            liveUrl: status === TaskStatus.DONE ? "https://example.com/demo" : null,
          },
        });
        if (status === TaskStatus.DONE || status === TaskStatus.NEEDS_IMPROVEMENT) {
          await prisma.feedback.create({
            data: {
              submissionId: sub.id,
              reviewerId: trainer.id,
              comment:
                status === TaskStatus.DONE
                  ? "Good work — approved."
                  : "Needs improvement: fix responsive layout.",
              newStatus: status,
            },
          });
        }
      }
    }
  }

  const counts = {
    users: await prisma.user.count(),
    interns: await prisma.internProfile.count(),
    attendance: await prisma.attendance.count(),
    assignments: await prisma.taskAssignment.count(),
    groups: await prisma.trainingGroup.count({ where: { trainerId: trainer.id, isActive: true } }),
  };

  console.log("Demo seed complete:", counts);
  console.log("Logins (password123): admin/hr/trainer/intern/college @smm.local");
  console.log("Also: intern1@smm.local … intern24@smm.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
