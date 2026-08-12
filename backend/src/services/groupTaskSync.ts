import { TaskStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { computeDayAndTask } from "./dayTask";

type TaskIdentity = {
  id: string;
  title: string;
  sourceLibraryId?: string | null;
};

type GroupTaskRow = {
  id: string;
  title: string;
  sourceLibraryId: string | null;
  assignments: {
    forDate: Date;
    dayNumber: number;
    taskNumber: number;
  }[];
};

/** Same curriculum task across groups → one identity (library id, else normalized title). */
export function taskIdentityKey(task: TaskIdentity): string {
  if (task.sourceLibraryId) return `lib:${task.sourceLibraryId}`;
  return `title:${task.title.trim().toLowerCase()}`;
}

const taskSelect = {
  id: true,
  title: true,
  sourceLibraryId: true,
  assignments: {
    take: 1,
    orderBy: { createdAt: "asc" as const },
    select: {
      forDate: true,
      dayNumber: true,
      taskNumber: true,
    },
  },
};

/**
 * Group-wide tasks for sync when a new member joins.
 * Includes tasks tagged with groupId. Legacy untagged tasks only if assigned to 2+
 * current/past members of this group (excludes one-off individual assignments).
 */
export async function findTasksForGroup(groupId: string): Promise<GroupTaskRow[]> {
  const tagged = await prisma.task.findMany({
    where: {
      groupId,
      isLibrary: false,
      assignments: { some: {} },
    },
    select: taskSelect,
  });

  const memberIds = (
    await prisma.groupMember.findMany({
      where: { groupId },
      select: { internId: true },
    })
  ).map((m) => m.internId);

  if (memberIds.length < 2) {
    return tagged;
  }

  const taggedIds = new Set(tagged.map((t) => t.id));
  const legacyRaw = await prisma.task.findMany({
    where: {
      isLibrary: false,
      groupId: null,
      assignments: { some: { internId: { in: memberIds } } },
    },
    select: {
      id: true,
      title: true,
      sourceLibraryId: true,
      assignments: {
        where: { internId: { in: memberIds } },
        orderBy: { createdAt: "asc" },
        select: {
          forDate: true,
          dayNumber: true,
          taskNumber: true,
          createdAt: true,
        },
      },
    },
  });

  const legacy: GroupTaskRow[] = [];
  for (const t of legacyRaw) {
    if (taggedIds.has(t.id)) continue;
    if (t.assignments.length < 2) continue; // individual assign — skip
    const first = t.assignments[0];
    legacy.push({
      id: t.id,
      title: t.title,
      sourceLibraryId: t.sourceLibraryId,
      assignments: [
        {
          forDate: first.forDate,
          dayNumber: first.dayNumber,
          taskNumber: first.taskNumber,
        },
      ],
    });
  }

  return [...tagged, ...legacy];
}

export async function findSiblingAssignment(
  internId: string,
  identity: string,
  excludeTaskId?: string,
) {
  const rows = await prisma.taskAssignment.findMany({
    where: {
      internId,
      ...(excludeTaskId ? { taskId: { not: excludeTaskId } } : {}),
    },
    include: {
      task: { select: { id: true, title: true, sourceLibraryId: true } },
      submission: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.find((r) => taskIdentityKey(r.task) === identity) || null;
}

/**
 * When intern(s) join a group, copy that group's existing tasks onto them.
 * If they already have the same curriculum task from another group, reuse status/submission.
 */
export async function syncGroupTasksToInterns(groupId: string, internIds: string[]) {
  const uniqueIds = [...new Set(internIds.filter(Boolean))];
  if (!uniqueIds.length) return { assigned: 0, synced: 0, taskCount: 0 };

  const groupTasks = await findTasksForGroup(groupId);
  let assigned = 0;
  let synced = 0;

  for (const task of groupTasks) {
    const identity = taskIdentityKey(task);
    const peer = task.assignments[0];

    for (const internId of uniqueIds) {
      const exists = await prisma.taskAssignment.findUnique({
        where: { taskId_internId: { taskId: task.id, internId } },
      });
      if (exists) continue;

      const sibling = await findSiblingAssignment(internId, identity, task.id);
      const forDate = peer?.forDate || sibling?.forDate || new Date();
      let dayNumber = sibling?.dayNumber ?? peer?.dayNumber;
      let taskNumber = sibling?.taskNumber ?? peer?.taskNumber;
      if (dayNumber == null || taskNumber == null) {
        const computed = await computeDayAndTask(internId, forDate);
        dayNumber = dayNumber ?? computed.dayNumber;
        taskNumber = taskNumber ?? computed.taskNumber;
      }

      const created = await prisma.taskAssignment.create({
        data: {
          taskId: task.id,
          internId,
          status: sibling?.status || TaskStatus.ASSIGNED,
          forDate,
          dayNumber,
          taskNumber,
        },
      });
      assigned += 1;

      if (sibling?.submission) {
        await prisma.submission.create({
          data: {
            assignmentId: created.id,
            projectDetails: sibling.submission.projectDetails,
            githubUrl: sibling.submission.githubUrl,
            liveUrl: sibling.submission.liveUrl,
            submittedAt: sibling.submission.submittedAt,
          },
        });
        synced += 1;
      } else if (sibling && sibling.status !== TaskStatus.ASSIGNED) {
        synced += 1;
      }
    }
  }

  if (assigned > 0) {
    console.log(
      `[groupTaskSync] group=${groupId} interns=${uniqueIds.length} tasks=${groupTasks.length} assigned=${assigned}`,
    );
  }

  return { assigned, synced, taskCount: groupTasks.length };
}

/** Heal missing assignments for every active member of a group. */
export async function syncAllActiveMembers(groupId: string) {
  const members = await prisma.groupMember.findMany({
    where: { groupId, isActive: true },
    select: { internId: true },
  });
  return syncGroupTasksToInterns(
    groupId,
    members.map((m) => m.internId),
  );
}

/** After submit/review on one assignment, mirror to same-identity assignments for that intern. */
export async function syncSiblingAssignments(
  assignmentId: string,
  opts: {
    status: TaskStatus;
    submission?: {
      projectDetails: string;
      githubUrl: string;
      liveUrl?: string | null;
      submittedAt?: Date;
    };
    feedback?: { reviewerId: string; comment: string; newStatus: TaskStatus };
  },
) {
  const root = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      task: { select: { id: true, title: true, sourceLibraryId: true } },
      submission: true,
    },
  });
  if (!root) return 0;

  const identity = taskIdentityKey(root.task);
  const siblings = await prisma.taskAssignment.findMany({
    where: {
      internId: root.internId,
      id: { not: root.id },
    },
    include: {
      task: { select: { id: true, title: true, sourceLibraryId: true } },
      submission: true,
    },
  });

  const targets = siblings.filter((s) => taskIdentityKey(s.task) === identity);
  let n = 0;
  for (const s of targets) {
    await prisma.taskAssignment.update({
      where: { id: s.id },
      data: { status: opts.status },
    });

    if (opts.submission) {
      const sub = await prisma.submission.upsert({
        where: { assignmentId: s.id },
        update: {
          projectDetails: opts.submission.projectDetails,
          githubUrl: opts.submission.githubUrl,
          liveUrl: opts.submission.liveUrl ?? null,
          submittedAt: opts.submission.submittedAt || new Date(),
        },
        create: {
          assignmentId: s.id,
          projectDetails: opts.submission.projectDetails,
          githubUrl: opts.submission.githubUrl,
          liveUrl: opts.submission.liveUrl ?? null,
          submittedAt: opts.submission.submittedAt || new Date(),
        },
      });
      if (opts.feedback) {
        await prisma.feedback.create({
          data: {
            submissionId: sub.id,
            reviewerId: opts.feedback.reviewerId,
            comment: opts.feedback.comment,
            newStatus: opts.feedback.newStatus,
          },
        });
      }
    }
    n += 1;
  }
  return n;
}

/** Deduplicate assignments for intern-facing lists / overall analytics. */
export function dedupeAssignmentsByIdentity<
  T extends { id: string; createdAt: Date; task: TaskIdentity },
>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = taskIdentityKey(row.task);
    const prev = map.get(key);
    if (!prev || row.createdAt < prev.createdAt) map.set(key, row);
  }
  return [...map.values()];
}
