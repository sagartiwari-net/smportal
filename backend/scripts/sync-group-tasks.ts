/**
 * One-off / ops: sync group tasks to all active members.
 * Usage (from backend/):
 *   npx tsx scripts/sync-group-tasks.ts "Smit_july2026"
 *   npx tsx scripts/sync-group-tasks.ts "Smit_july2026" gryadav772@gmail.com
 */
import { prisma } from "../src/config/db";
import { findTasksForGroup, syncAllActiveMembers, syncGroupTasksToInterns } from "../src/services/groupTaskSync";

async function main() {
  const groupName = process.argv[2];
  const email = process.argv[3];

  if (!groupName) {
    console.error('Usage: npx tsx scripts/sync-group-tasks.ts "<group name>" [intern-email]');
    process.exit(1);
  }

  const group = await prisma.trainingGroup.findFirst({ where: { name: groupName } });
  if (!group) {
    console.error(`Group not found: ${groupName}`);
    const similar = await prisma.trainingGroup.findMany({
      where: { name: { contains: groupName.slice(0, 4) } },
      select: { id: true, name: true },
      take: 10,
    });
    if (similar.length) console.error("Similar:", similar);
    process.exit(1);
  }

  const tasks = await findTasksForGroup(group.id);
  console.log(`Group: ${group.name} (${group.id})`);
  console.log(`Group-wide tasks found: ${tasks.length}`);
  for (const t of tasks) console.log(`  - ${t.title}`);

  if (email) {
    const intern = await prisma.internProfile.findFirst({
      where: { user: { email: email.toLowerCase() } },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!intern) {
      console.error(`Intern not found: ${email}`);
      process.exit(1);
    }
    console.log(`Syncing to: ${intern.user.fullName} (${intern.user.email})`);
    const sync = await syncGroupTasksToInterns(group.id, [intern.id]);
    console.log("Sync result:", sync);
    const count = await prisma.taskAssignment.count({ where: { internId: intern.id } });
    console.log(`Assignments for intern now: ${count}`);
  } else {
    const sync = await syncAllActiveMembers(group.id);
    console.log("Sync result:", sync);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
