import { prisma } from "../config/db";

/** Group IDs this trainer can access (primary trainerId OR GroupTrainer link) */
export async function getTrainerGroupIds(trainerUserId: string): Promise<string[]> {
  const [primary, links] = await Promise.all([
    prisma.trainingGroup.findMany({
      where: { trainerId: trainerUserId, isActive: true },
      select: { id: true },
    }),
    prisma.groupTrainer.findMany({
      where: { trainerId: trainerUserId, group: { isActive: true } },
      select: { groupId: true },
    }),
  ]);
  return [...new Set([...primary.map((g) => g.id), ...links.map((l) => l.groupId)])];
}

export async function trainerOwnsGroup(trainerUserId: string, groupId: string) {
  const ids = await getTrainerGroupIds(trainerUserId);
  return ids.includes(groupId);
}

/** Intern must be active member of one of trainer's groups */
export async function trainerCanAccessIntern(trainerUserId: string, internId: string) {
  const groupIds = await getTrainerGroupIds(trainerUserId);
  if (!groupIds.length) return false;
  const m = await prisma.groupMember.findFirst({
    where: { internId, isActive: true, groupId: { in: groupIds } },
  });
  return !!m;
}

/** Keep GroupTrainer in sync when primary trainerId is set */
export async function syncPrimaryGroupTrainer(groupId: string, trainerId: string | null) {
  if (!trainerId) return;
  await prisma.groupTrainer.upsert({
    where: { groupId_trainerId: { groupId, trainerId } },
    update: {},
    create: { groupId, trainerId },
  });
}
