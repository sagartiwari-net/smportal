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

/**
 * Group-wide tasks for sync when a new member joins.
 * - Tasks tagged with this groupId (always)
 * - Legacy bulk assigns: same task given to 2+ members of this group (not one-off individual)
 * Dedupes by curriculum identity; picks the task row most members already use.
 */
export async function findTasksForGroup(groupId: string): Promise<GroupTaskRow[]> {
  const activeMemberIds = (
    await prisma.groupMember.findMany({
      where: { groupId, isActive: true },
      select: { internId: true },
    })
  ).map((m) => m.internId);

  const allMemberIds = (
    await prisma.groupMember.findMany({
      where: { groupId },
      select: { internId: true },
    })
  ).map((m) => m.internId);

  if (!allMemberIds.length) return [];

  const rows = await prisma.taskAssignment.findMany({
    where: {
      internId: { in: allMemberIds },
      task: { isLibrary: false },
    },
    select: {
      internId: true,
      forDate: true,
      dayNumber: true,
      taskNumber: true,
      createdAt: true,
      task: {
        select: {
          id: true,
          title: true,
          sourceLibraryId: true,
          groupId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  type Agg = {
    task: { id: string; title: string; sourceLibraryId: string | null; groupId: string | null };
    assignees: Set<string>;
    first: { forDate: Date; dayNumber: number; taskNumber: number };
  };
  const byTaskId = new Map<string, Agg>();

  for (const r of rows) {
    let agg = byTaskId.get(r.task.id);
    if (!agg) {
      agg = {
        task: r.task,
        assignees: new Set(),
        first: { forDate: r.forDate, dayNumber: r.dayNumber, taskNumber: r.taskNumber },
      };
      byTaskId.set(r.task.id, agg);
    }
    agg.assignees.add(r.internId);
  }

  const minBulkAssignees = activeMemberIds.length <= 1 ? 1 : 2;
  const candidates: GroupTaskRow[] = [];

  for (const agg of byTaskId.values()) {
    const taggedThisGroup = agg.task.groupId === groupId;
    const bulkForGroup = agg.assignees.size >= minBulkAssignees;
    if (!taggedThisGroup && !bulkForGroup) continue;

    candidates.push({
      id: agg.task.id,
      title: agg.task.title,
      sourceLibraryId: agg.task.sourceLibraryId,
      assignments: [agg.first],
    });
  }

  // One row per curriculum task — use the clone most members already have
  const byIdentity = new Map<string, GroupTaskRow & { assigneeCount: number }>();
  for (const c of candidates) {
    const key = taskIdentityKey(c);
    const count = byTaskId.get(c.id)?.assignees.size ?? 0;
    const prev = byIdentity.get(key);
    if (!prev || count > prev.assigneeCount) {
      byIdentity.set(key, { ...c, assigneeCount: count });
    }
  }

  const result = [...byIdentity.values()].map(({ assigneeCount: _, ...rest }) => rest);

  if (result.length === 0 && rows.length > 0) {
    console.warn(
      `[groupTaskSync] group=${groupId} has ${rows.length} assignment row(s) but 0 group-wide tasks (likely individual-only assigns)`,
    );
  }

  return result;
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
            submitCount: sibling.submission.submitCount ?? 1,
          },
        });
        synced += 1;
      } else if (sibling && sibling.status !== TaskStatus.ASSIGNED) {
        synced += 1;
      }
    }
  }

  console.log(
    `[groupTaskSync] group=${groupId} interns=${uniqueIds.length} found=${groupTasks.length} assigned=${assigned} synced=${synced}`,
  );

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
      submitCount?: number;
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
          ...(opts.submission.submitCount != null ? { submitCount: opts.submission.submitCount } : {}),
        },
        create: {
          assignmentId: s.id,
          projectDetails: opts.submission.projectDetails,
          githubUrl: opts.submission.githubUrl,
          liveUrl: opts.submission.liveUrl ?? null,
          submittedAt: opts.submission.submittedAt || new Date(),
          submitCount: opts.submission.submitCount ?? 1,
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
