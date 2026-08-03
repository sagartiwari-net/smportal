import { Router } from "express";
import { z } from "zod";
import { TaskStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeDayAndTask, displayLabel, toDayDate } from "../services/dayTask";
import {
  getTrainerGroupIds,
  trainerCanAccessIntern,
  trainerOwnsGroup,
} from "../services/trainerScope";
import { buildTasksExcel, buildTaskBatchExcel } from "../services/tasksReportExcel";

const router = Router();
router.use(requireAuth);

async function internProfileId(userId: string) {
  const p = await prisma.internProfile.findUnique({ where: { userId } });
  return p?.id;
}

function withLabels<T extends { dayNumber: number; taskNumber: number; task: { title: string } }>(
  assignments: T[],
) {
  return assignments.map((a) => ({
    ...a,
    displayLabel: displayLabel(a.dayNumber, a.taskNumber, a.task.title),
  }));
}

/** Flatten group/college/audit fields for staff UI */
function enrichStaffAssignments(
  assignments: Array<{
    id: string;
    status: string;
    forDate: Date;
    dayNumber: number;
    taskNumber: number;
    createdAt: Date;
    updatedAt: Date;
    task: {
      id: string;
      title: string;
      description: string;
      dueDate: Date | null;
      createdBy?: { id: string; fullName: string; email: string; role?: string } | null;
    };
    intern?: {
      id: string;
      user: { fullName: string; email: string };
      college?: { name: string } | null;
      memberships?: { group: { id: string; name: string; trainerId: string | null } }[];
    } | null;
    submission?: {
      projectDetails: string;
      githubUrl: string;
      liveUrl?: string | null;
      submittedAt?: Date;
      feedbacks?: {
        comment: string;
        newStatus: string;
        createdAt: Date;
        reviewer?: { id: string; fullName: string; role?: string } | null;
      }[];
    } | null;
  }>,
) {
  return withLabels(assignments).map((a) => {
    const group = a.intern?.memberships?.[0]?.group;
    const feedbacks = a.submission?.feedbacks || [];
    const lastFb = feedbacks[0];
    return {
      ...a,
      groupId: group?.id || null,
      groupName: group?.name || "Unassigned / no group",
      collegeName: a.intern?.college?.name || null,
      assignedBy: a.task.createdBy
        ? {
            id: a.task.createdBy.id,
            fullName: a.task.createdBy.fullName,
            email: a.task.createdBy.email,
            role: a.task.createdBy.role || null,
          }
        : null,
      assignedAt: a.createdAt,
      submittedAt: a.submission?.submittedAt || null,
      lastReview: lastFb
        ? {
            status: lastFb.newStatus,
            comment: lastFb.comment,
            at: lastFb.createdAt,
            by: lastFb.reviewer?.fullName || null,
            byId: lastFb.reviewer?.id || null,
            byRole: lastFb.reviewer?.role || null,
          }
        : null,
      reviewHistory: feedbacks.map((f) => ({
        status: f.newStatus,
        comment: f.comment,
        at: f.createdAt,
        by: f.reviewer?.fullName || null,
        byRole: f.reviewer?.role || null,
      })),
    };
  });
}

const staffInclude = {
  task: {
    include: {
      createdBy: { select: { id: true, fullName: true, email: true, role: true } },
    },
  },
  intern: {
    include: {
      user: { select: { fullName: true, email: true } },
      college: { select: { name: true } },
      memberships: {
        where: { isActive: true },
        take: 1,
        include: { group: { select: { id: true, name: true, trainerId: true } } },
      },
    },
  },
  submission: {
    include: {
      feedbacks: {
        orderBy: { createdAt: "desc" as const },
        include: { reviewer: { select: { id: true, fullName: true, role: true } } },
      },
    },
  },
};

async function resolveInternIds(groupId?: string, internIds?: string[]) {
  let target: string[] = internIds || [];
  if (groupId) {
    const members = await prisma.groupMember.findMany({
      where: { groupId, isActive: true },
      select: { internId: true },
    });
    target = [...new Set([...target, ...members.map((m) => m.internId)])];
  }
  return target;
}

async function assignTaskToInterns(taskId: string, title: string, forDate: Date, internIds: string[]) {
  const created = [];
  const skipped: string[] = [];
  for (const internId of internIds) {
    const exists = await prisma.taskAssignment.findUnique({
      where: { taskId_internId: { taskId, internId } },
    });
    if (exists) {
      skipped.push(internId);
      continue;
    }
    const { dayNumber, taskNumber } = await computeDayAndTask(internId, forDate);
    const row = await prisma.taskAssignment.create({
      data: {
        taskId,
        internId,
        status: TaskStatus.ASSIGNED,
        forDate,
        dayNumber,
        taskNumber,
      },
    });
    created.push({
      ...row,
      displayLabel: displayLabel(dayNumber, taskNumber, title),
    });
  }
  return { created, skipped };
}

/** Trainer may only touch their groups' interns */
async function assertTrainerTargets(
  role: string,
  userId: string,
  groupId?: string,
  internIds?: string[],
) {
  if (role !== "TRAINER") return null;
  if (groupId) {
    const ok = await trainerOwnsGroup(userId, groupId);
    if (!ok) return "You can only assign to your own groups";
  }
  if (internIds?.length) {
    for (const iid of internIds) {
      const ok = await trainerCanAccessIntern(userId, iid);
      if (!ok) return "One or more interns are outside your groups";
    }
  }
  return null;
}

function parsePageLimit(query: Record<string, unknown>, fallbackLimit = 10) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  let limit = Number.parseInt(String(query.limit ?? fallbackLimit), 10) || fallbackLimit;
  if (![10, 20, 30].includes(limit)) limit = fallbackLimit;
  return { page, limit, skip: (page - 1) * limit };
}

function assignmentSearchWhere(search: string) {
  if (!search) return {};
  return {
    OR: [
      { task: { title: { contains: search } } },
      { intern: { user: { fullName: { contains: search } } } },
      { intern: { user: { email: { contains: search } } } },
      { intern: { college: { name: { contains: search } } } },
    ],
  };
}

async function statusCountsFor(where: object) {
  const rows = await prisma.taskAssignment.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const counts = { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof typeof counts] = r._count._all;
  }
  return counts;
}

function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}

router.get("/", async (req, res) => {
  const role = req.user!.role;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const { page, limit, skip } = parsePageLimit(req.query as Record<string, unknown>);

  const statusWhere =
    statusFilter && Object.values(TaskStatus).includes(statusFilter as TaskStatus)
      ? { status: statusFilter as TaskStatus }
      : {};
  const searchWhere = assignmentSearchWhere(search);

  if (role === "INTERN") {
    const iid = await internProfileId(req.user!.id);
    const where = { internId: iid || "", ...statusWhere, ...searchWhere };
    const [total, assignments, statusCounts] = await Promise.all([
      prisma.taskAssignment.count({ where }),
      prisma.taskAssignment.findMany({
        where,
        include: {
          task: true,
          submission: {
            include: {
              feedbacks: {
                orderBy: { createdAt: "desc" as const },
                include: { reviewer: { select: { fullName: true } } },
              },
            },
          },
        },
        orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
        skip,
        take: limit,
      }),
      statusCountsFor({ internId: iid || "", ...searchWhere }),
    ]);
    return res.json({
      assignments: withLabels(assignments),
      pagination: paginationMeta(page, limit, total),
      statusCounts,
    });
  }

  if (role === "TRAINER") {
    const myGroupIds = await getTrainerGroupIds(req.user!.id);
    if (groupIdFilter && !myGroupIds.includes(groupIdFilter)) {
      return res.json({
        assignments: [],
        pagination: paginationMeta(page, limit, 0),
        statusCounts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
      });
    }
    const scopeGroupIds = groupIdFilter ? [groupIdFilter] : myGroupIds;
    if (!scopeGroupIds.length) {
      return res.json({
        assignments: [],
        pagination: paginationMeta(page, limit, 0),
        statusCounts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
      });
    }

    const scopeWhere = {
      intern: {
        memberships: {
          some: { isActive: true, groupId: { in: scopeGroupIds } },
        },
      },
    };
    const where = { ...statusWhere, ...searchWhere, ...scopeWhere };
    const [total, assignments, statusCounts] = await Promise.all([
      prisma.taskAssignment.count({ where }),
      prisma.taskAssignment.findMany({
        where,
        include: staffInclude,
        orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
        skip,
        take: limit,
      }),
      statusCountsFor({ ...searchWhere, ...scopeWhere }),
    ]);
    return res.json({
      assignments: enrichStaffAssignments(assignments),
      pagination: paginationMeta(page, limit, total),
      statusCounts,
    });
  }

  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const scopeWhere = {
      intern: {
        collegeId: profile?.collegeId || "",
        ...(groupIdFilter
          ? { memberships: { some: { isActive: true, groupId: groupIdFilter } } }
          : {}),
      },
    };
    const where = { ...statusWhere, ...searchWhere, ...scopeWhere };
    const [total, assignments, statusCounts] = await Promise.all([
      prisma.taskAssignment.count({ where }),
      prisma.taskAssignment.findMany({
        where,
        include: staffInclude,
        orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
        skip,
        take: limit,
      }),
      statusCountsFor({ ...searchWhere, ...scopeWhere }),
    ]);
    return res.json({
      assignments: enrichStaffAssignments(assignments),
      pagination: paginationMeta(page, limit, total),
      statusCounts,
    });
  }

  // ADMIN / HR — all, optional filters
  const scopeWhere = groupIdFilter
    ? { intern: { memberships: { some: { isActive: true, groupId: groupIdFilter } } } }
    : {};
  const where = { ...statusWhere, ...searchWhere, ...scopeWhere };
  const [total, assignments, statusCounts] = await Promise.all([
    prisma.taskAssignment.count({ where }),
    prisma.taskAssignment.findMany({
      where,
      include: staffInclude,
      orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
    }),
    statusCountsFor({ ...searchWhere, ...scopeWhere }),
  ]);
  res.json({
    assignments: enrichStaffAssignments(assignments),
    pagination: paginationMeta(page, limit, total),
    statusCounts,
  });
});

/** Build Prisma where for staff/college assignment scope */
async function staffAssignmentsScope(
  role: string,
  userId: string,
  groupIdFilter: string,
): Promise<{ where: object; empty?: boolean }> {
  if (role === "TRAINER") {
    const myGroupIds = await getTrainerGroupIds(userId);
    if (groupIdFilter && !myGroupIds.includes(groupIdFilter)) return { where: {}, empty: true };
    const scopeGroupIds = groupIdFilter ? [groupIdFilter] : myGroupIds;
    if (!scopeGroupIds.length) return { where: {}, empty: true };
    return {
      where: {
        intern: {
          memberships: { some: { isActive: true, groupId: { in: scopeGroupIds } } },
        },
      },
    };
  }
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId } });
    return {
      where: {
        intern: {
          collegeId: profile?.collegeId || "",
          ...(groupIdFilter
            ? { memberships: { some: { isActive: true, groupId: groupIdFilter } } }
            : {}),
        },
      },
    };
  }
  // ADMIN / HR
  return {
    where: groupIdFilter
      ? { intern: { memberships: { some: { isActive: true, groupId: groupIdFilter } } } }
      : {},
  };
}

/** Excel — all assignments matching filters (not paginated screen page) */
router.get("/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE", "INTERN"), async (req, res) => {
  const role = req.user!.role;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const assignedById = typeof req.query.assignedById === "string" ? req.query.assignedById : "";
  const reviewedById = typeof req.query.reviewedById === "string" ? req.query.reviewedById : "";

  const statusWhere =
    statusFilter && Object.values(TaskStatus).includes(statusFilter as TaskStatus)
      ? { status: statusFilter as TaskStatus }
      : {};
  const searchWhere = assignmentSearchWhere(search);
  const assignedWhere = assignedById ? { task: { createdById: assignedById } } : {};
  const reviewedWhere = reviewedById
    ? { submission: { feedbacks: { some: { reviewerId: reviewedById } } } }
    : {};

  let where: object = { ...statusWhere, ...searchWhere, ...assignedWhere, ...reviewedWhere };
  let filterParts = [
    statusFilter && statusFilter !== "all" ? `status=${statusFilter}` : "status=all",
    groupIdFilter ? `group=${groupIdFilter}` : "group=all",
    search ? `search=${search}` : "",
    assignedById ? `assignedBy=${assignedById}` : "",
    reviewedById ? `reviewedBy=${reviewedById}` : "",
  ].filter(Boolean);

  if (role === "INTERN") {
    const iid = await internProfileId(req.user!.id);
    where = { internId: iid || "", ...statusWhere, ...searchWhere };
    filterParts = ["own tasks", ...filterParts];
  } else {
    const scope = await staffAssignmentsScope(role, req.user!.id, groupIdFilter === "all" ? "" : groupIdFilter);
    if (scope.empty) {
      const { buffer, filename } = await buildTasksExcel({
        filterLabel: filterParts.join(" · "),
        counts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
        rows: [],
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
    where = { ...where, ...scope.where };
  }

  try {
    const [assignments, counts] = await Promise.all([
      prisma.taskAssignment.findMany({
        where,
        include: staffInclude,
        orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
        take: 10000,
      }),
      statusCountsFor(where),
    ]);
    const enriched = enrichStaffAssignments(assignments);
    const { buffer, filename } = await buildTasksExcel({
      filterLabel: filterParts.join(" · ") || "all",
      counts,
      rows: enriched.map((a) => ({
        student: a.intern?.user?.fullName || "—",
        email: a.intern?.user?.email || null,
        group: a.groupName || "—",
        college: a.collegeName || "—",
        day: a.dayNumber,
        taskNo: a.taskNumber,
        title: a.task.title,
        forDate: a.forDate.toISOString().slice(0, 10),
        status: a.status,
        assignedBy: a.assignedBy?.fullName || "—",
        submittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString().slice(0, 10) : "—",
        lastReviewBy: a.lastReview?.by || "—",
        lastReviewComment: a.lastReview?.comment || "—",
      })),
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Export failed" });
  }
});

type BatchAgg = {
  key: string;
  taskId: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string;
  forDate: Date;
  dayNumber: number;
  taskNumber: number;
  displayLabel: string;
  total: number;
  counts: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  matchStatus: boolean;
  assignedBy: { id: string; fullName: string; email: string; role: string } | null;
  assignedAt: Date | null;
  reviewers: { id: string; fullName: string; role: string }[];
};

/**
 * Staff manage list: one row per task×group (not per intern).
 * - view=groups → accordion headers (all groups collapsed by default on UI)
 * - groupId=… → paginated tasks for that one group only
 */
router.get("/batches", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const assignedById = typeof req.query.assignedById === "string" ? req.query.assignedById : "";
  const reviewedById = typeof req.query.reviewedById === "string" ? req.query.reviewedById : "";
  const viewGroups = req.query.view === "groups";
  const { page, limit, skip } = parsePageLimit(req.query as Record<string, unknown>);

  // Groups overview uses optional group filter from UI; task list requires a group
  const scopeGroupId = viewGroups ? groupIdFilter : groupIdFilter;
  const scope = await staffAssignmentsScope(role, req.user!.id, scopeGroupId);
  if (scope.empty) {
    return res.json({
      groups: [],
      batches: [],
      pagination: paginationMeta(page, limit, 0),
      statusCounts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
    });
  }

  const auditWhere = {
    ...(assignedById ? { task: { createdById: assignedById } } : {}),
    ...(reviewedById
      ? { submission: { feedbacks: { some: { reviewerId: reviewedById } } } }
      : {}),
  };

  const rows = await prisma.taskAssignment.findMany({
    where: { ...scope.where, ...auditWhere },
    select: {
      status: true,
      forDate: true,
      dayNumber: true,
      taskNumber: true,
      taskId: true,
      createdAt: true,
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          createdBy: { select: { id: true, fullName: true, email: true, role: true } },
        },
      },
      intern: {
        select: {
          user: { select: { fullName: true, email: true } },
          college: { select: { name: true } },
          memberships: {
            where: { isActive: true },
            take: 1,
            select: { group: { select: { id: true, name: true } } },
          },
        },
      },
      submission: {
        select: {
          feedbacks: {
            select: {
              reviewer: { select: { id: true, fullName: true, role: true } },
            },
          },
        },
      },
    },
    orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
  });

  const map = new Map<string, BatchAgg>();
  for (const r of rows) {
    const group = r.intern?.memberships?.[0]?.group;
    const gid = group?.id || "unassigned";
    const gname = group?.name || "Unassigned / no group";
    const key = `${r.taskId}::${gid}`;
    let b = map.get(key);
    if (!b) {
      const cb = r.task.createdBy;
      b = {
        key,
        taskId: r.taskId,
        groupId: gid,
        groupName: gname,
        title: r.task.title,
        description: r.task.description,
        forDate: r.forDate,
        dayNumber: r.dayNumber,
        taskNumber: r.taskNumber,
        displayLabel: displayLabel(r.dayNumber, r.taskNumber, r.task.title),
        total: 0,
        counts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
        matchStatus: false,
        assignedBy: cb
          ? { id: cb.id, fullName: cb.fullName, email: cb.email, role: cb.role }
          : null,
        assignedAt: r.createdAt,
        reviewers: [],
      };
      map.set(key, b);
    }
    b.total += 1;
    if (r.status in b.counts) b.counts[r.status as keyof typeof b.counts] += 1;
    if (!statusFilter || r.status === statusFilter) b.matchStatus = true;
    if (r.forDate > b.forDate) b.forDate = r.forDate;
    if (!b.assignedAt || r.createdAt < b.assignedAt) b.assignedAt = r.createdAt;
    for (const fb of r.submission?.feedbacks || []) {
      const rev = fb.reviewer;
      if (!rev) continue;
      if (!b.reviewers.some((x) => x.id === rev.id)) {
        b.reviewers.push({ id: rev.id, fullName: rev.fullName, role: rev.role });
      }
    }
  }

  let batches = [...map.values()];

  if (statusFilter && Object.values(TaskStatus).includes(statusFilter as TaskStatus)) {
    batches = batches.filter((b) => b.matchStatus);
  }

  if (search) {
    batches = batches.filter((b) => {
      if (
        b.title.toLowerCase().includes(search) ||
        b.displayLabel.toLowerCase().includes(search) ||
        b.groupName.toLowerCase().includes(search)
      ) {
        return true;
      }
      return rows.some((r) => {
        const group = r.intern?.memberships?.[0]?.group;
        const gid = group?.id || "unassigned";
        if (`${r.taskId}::${gid}` !== b.key) return false;
        const name = r.intern?.user.fullName?.toLowerCase() || "";
        const email = r.intern?.user.email?.toLowerCase() || "";
        const college = r.intern?.college?.name?.toLowerCase() || "";
        return name.includes(search) || email.includes(search) || college.includes(search);
      });
    });
  }

  const overallScope = await staffAssignmentsScope(role, req.user!.id, "");
  const statusCounts = overallScope.empty
    ? { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 }
    : await statusCountsFor(overallScope.where);

  // Accordion headers: one entry per group that has matching tasks
  if (viewGroups) {
    const groupMap = new Map<
      string,
      {
        groupId: string;
        groupName: string;
        taskCount: number;
        internAssignments: number;
        counts: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
      }
    >();
    for (const b of batches) {
      let g = groupMap.get(b.groupId);
      if (!g) {
        g = {
          groupId: b.groupId,
          groupName: b.groupName,
          taskCount: 0,
          internAssignments: 0,
          counts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
        };
        groupMap.set(b.groupId, g);
      }
      g.taskCount += 1;
      g.internAssignments += b.total;
      g.counts.ASSIGNED += b.counts.ASSIGNED;
      g.counts.SUBMITTED += b.counts.SUBMITTED;
      g.counts.NEEDS_IMPROVEMENT += b.counts.NEEDS_IMPROVEMENT;
      g.counts.DONE += b.counts.DONE;
    }
    const groups = [...groupMap.values()].sort((a, b) => a.groupName.localeCompare(b.groupName));
    return res.json({ groups, batches: [], statusCounts });
  }

  if (!groupIdFilter) {
    return res.status(400).json({ message: "groupId required to list tasks (open a group)" });
  }

  batches = batches.filter((b) => b.groupId === groupIdFilter);
  batches.sort((a, b) => b.forDate.getTime() - a.forDate.getTime());

  const total = batches.length;
  const pageRows = batches.slice(skip, skip + limit).map(({ matchStatus: _m, ...rest }) => ({
    ...rest,
    forDate: rest.forDate,
  }));

  res.json({
    batches: pageRows,
    pagination: paginationMeta(page, limit, total),
    statusCounts,
  });
});

/** Distinct assigners / reviewers in current staff scope (for filter dropdowns) */
router.get("/batches/actors", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  const scope = await staffAssignmentsScope(role, req.user!.id, groupIdFilter);
  if (scope.empty) {
    return res.json({ assigners: [], reviewers: [] });
  }

  const [assignerRows, reviewerRows] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "HR", "TRAINER"] },
        createdTasks: {
          some: {
            assignments: { some: scope.where },
          },
        },
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "HR", "TRAINER"] },
        feedbacks: {
          some: {
            submission: {
              assignment: scope.where,
            },
          },
        },
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  res.json({
    assigners: assignerRows,
    reviewers: reviewerRows,
  });
});

/** Interns for one task×group batch — used after clicking a task card */
router.get("/batches/interns", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const taskId = typeof req.query.taskId === "string" ? req.query.taskId : "";
  const groupId = typeof req.query.groupId === "string" ? req.query.groupId : "";
  if (!taskId) return res.status(400).json({ message: "taskId required" });

  if (role === "TRAINER" && groupId && groupId !== "unassigned") {
    const ok = await trainerOwnsGroup(req.user!.id, groupId);
    if (!ok) return res.status(403).json({ message: "Not your group" });
  }

  const scopeGroupFilter = groupId && groupId !== "unassigned" ? groupId : "";
  const scope = await staffAssignmentsScope(role, req.user!.id, scopeGroupFilter);
  if (scope.empty) return res.json({ assignments: [] });

  let where: object = { taskId, ...scope.where };
  if (groupId === "unassigned") {
    where = {
      taskId,
      intern: {
        memberships: { none: { isActive: true } },
        ...(role === "COLLEGE"
          ? {
              collegeId:
                (
                  await prisma.collegeProfile.findUnique({
                    where: { userId: req.user!.id },
                    select: { collegeId: true },
                  })
                )?.collegeId || "",
            }
          : {}),
      },
    };
  }

  const assignments = await prisma.taskAssignment.findMany({
    where,
    include: staffInclude,
    orderBy: [{ updatedAt: "desc" }],
  });

  const rank: Record<string, number> = {
    SUBMITTED: 0,
    NEEDS_IMPROVEMENT: 1,
    ASSIGNED: 2,
    DONE: 3,
  };
  const enriched = enrichStaffAssignments(assignments).sort(
    (a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
      (a.intern?.user.fullName || "").localeCompare(b.intern?.user.fullName || ""),
  );

  res.json({
    task: assignments[0]
      ? {
          id: assignments[0].task.id,
          title: assignments[0].task.title,
          description: assignments[0].task.description,
          displayLabel: displayLabel(assignments[0].dayNumber, assignments[0].taskNumber, assignments[0].task.title),
        }
      : null,
    groupId: groupId || null,
    groupName: enriched[0]?.groupName || null,
    assignments: enriched,
    counts: enriched.reduce(
      (acc, a) => {
        if (a.status in acc) acc[a.status as keyof typeof acc] += 1;
        return acc;
      },
      { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
    ),
  });
});

/** Excel — one managed task × group (intern list + dashboard) */
router.get("/batches/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const taskId = typeof req.query.taskId === "string" ? req.query.taskId : "";
  const groupId = typeof req.query.groupId === "string" ? req.query.groupId : "";
  if (!taskId) return res.status(400).json({ message: "taskId required" });

  if (role === "TRAINER" && groupId && groupId !== "unassigned") {
    const ok = await trainerOwnsGroup(req.user!.id, groupId);
    if (!ok) return res.status(403).json({ message: "Not your group" });
  }

  const scopeGroupFilter = groupId && groupId !== "unassigned" ? groupId : "";
  const scope = await staffAssignmentsScope(role, req.user!.id, scopeGroupFilter);
  if (scope.empty) {
    const { buffer, filename } = await buildTaskBatchExcel({
      taskLabel: "Task",
      groupName: groupId || "—",
      forDate: "—",
      counts: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
      rows: [],
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  let where: object = { taskId, ...scope.where };
  if (groupId === "unassigned") {
    where = {
      taskId,
      intern: {
        memberships: { none: { isActive: true } },
        ...(role === "COLLEGE"
          ? {
              collegeId:
                (
                  await prisma.collegeProfile.findUnique({
                    where: { userId: req.user!.id },
                    select: { collegeId: true },
                  })
                )?.collegeId || "",
            }
          : {}),
      },
    };
  }

  try {
    const assignments = await prisma.taskAssignment.findMany({
      where,
      include: staffInclude,
      orderBy: [{ updatedAt: "desc" }],
    });
    const enriched = enrichStaffAssignments(assignments);
    const counts = enriched.reduce(
      (acc, a) => {
        if (a.status in acc) acc[a.status as keyof typeof acc] += 1;
        return acc;
      },
      { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
    );
    const first = assignments[0];
    const { buffer, filename } = await buildTaskBatchExcel({
      taskLabel: first
        ? displayLabel(first.dayNumber, first.taskNumber, first.task.title)
        : "Task",
      groupName: enriched[0]?.groupName || groupId || "—",
      forDate: first ? first.forDate.toISOString().slice(0, 10) : "—",
      description: first?.task.description,
      assignedBy: first?.task.createdBy?.fullName,
      counts,
      rows: enriched.map((a) => ({
        student: a.intern?.user?.fullName || "—",
        email: a.intern?.user?.email || null,
        group: a.groupName || "—",
        college: a.collegeName || "—",
        day: a.dayNumber,
        taskNo: a.taskNumber,
        title: a.task.title,
        forDate: a.forDate.toISOString().slice(0, 10),
        status: a.status,
        assignedBy: a.assignedBy?.fullName || "—",
        submittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString().slice(0, 10) : "—",
        lastReviewBy: a.lastReview?.by || "—",
        lastReviewComment: a.lastReview?.comment || "—",
      })),
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Export failed" });
  }
});

router.get("/library", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const optionsOnly = req.query.options === "1" || req.query.options === "true";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where = {
    isLibrary: true,
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {}),
  };

  // Backfill missing libraryOrder once (1, 2, 3… by createdAt)
  const missingOrder = await prisma.task.findMany({
    where: { isLibrary: true, libraryOrder: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (missingOrder.length) {
    const maxRow = await prisma.task.aggregate({
      where: { isLibrary: true, libraryOrder: { not: null } },
      _max: { libraryOrder: true },
    });
    let next = (maxRow._max.libraryOrder || 0) + 1;
    for (const row of missingOrder) {
      await prisma.task.update({ where: { id: row.id }, data: { libraryOrder: next } });
      next += 1;
    }
  }

  // Lightweight list for assign dropdown (capped)
  if (optionsOnly) {
    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ libraryOrder: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: { id: true, title: true, libraryOrder: true },
    });
    return res.json({ tasks });
  }

  const { page, limit, skip } = parsePageLimit(req.query as Record<string, unknown>);
  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ libraryOrder: "asc" }, { createdAt: "asc" }],
      skip,
      take: limit,
      include: {
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const ids = tasks.map((t) => t.id);
  const cloneAssignments =
    ids.length === 0
      ? []
      : await prisma.taskAssignment.findMany({
          where: {
            task: {
              OR: [{ id: { in: ids } }, { sourceLibraryId: { in: ids } }],
            },
          },
          select: {
            forDate: true,
            createdAt: true,
            intern: {
              select: {
                id: true,
                user: { select: { fullName: true, email: true } },
                memberships: {
                  where: { isActive: true },
                  take: 1,
                  select: { group: { select: { id: true, name: true } } },
                },
              },
            },
            task: {
              select: {
                id: true,
                sourceLibraryId: true,
                group: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });

  const byLibrary = new Map<
    string,
    {
      totalAssignments: number;
      assignees: {
        internId: string;
        fullName: string;
        email: string;
        groupName: string | null;
        forDate: string;
      }[];
    }
  >();

  for (const a of cloneAssignments) {
    const libId = a.task.sourceLibraryId || a.task.id;
    if (!ids.includes(libId)) continue;
    let bucket = byLibrary.get(libId);
    if (!bucket) {
      bucket = { totalAssignments: 0, assignees: [] };
      byLibrary.set(libId, bucket);
    }
    bucket.totalAssignments += 1;
    const groupName =
      a.task.group?.name || a.intern.memberships[0]?.group.name || null;
    // Dedupe intern in list (keep latest)
    if (!bucket.assignees.some((x) => x.internId === a.intern.id)) {
      bucket.assignees.push({
        internId: a.intern.id,
        fullName: a.intern.user.fullName,
        email: a.intern.user.email,
        groupName,
        forDate: a.forDate.toISOString().slice(0, 10),
      });
    }
  }

  res.json({
    tasks: tasks.map((t) => {
      const hist = byLibrary.get(t.id);
      return {
        ...t,
        assignmentCount: hist?.totalAssignments ?? 0,
        assignees: hist?.assignees ?? [],
        _count: { assignments: hist?.totalAssignments ?? 0 },
      };
    }),
    pagination: paginationMeta(page, limit, total),
  });
});

router.get(
  "/library/:id/already-assigned",
  requireRole("ADMIN", "HR", "TRAINER"),
  async (req, res) => {
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
    const internIdsRaw = typeof req.query.internIds === "string" ? req.query.internIds : "";
    const internIdsParam = internIdsRaw
      ? internIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const library = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!library || !library.isLibrary) {
      return res.status(404).json({ message: "Library task not found" });
    }

    const deny = await assertTrainerTargets(req.user!.role, req.user!.id, groupId, internIdsParam);
    if (deny) return res.status(403).json({ message: deny });

    const targetInternIds = await resolveInternIds(groupId, internIdsParam);
    if (!targetInternIds.length) {
      return res.json({ alreadyAssigned: [], count: 0 });
    }

    const rows = await prisma.taskAssignment.findMany({
      where: {
        internId: { in: targetInternIds },
        task: {
          OR: [{ id: library.id }, { sourceLibraryId: library.id }],
        },
      },
      select: {
        forDate: true,
        intern: {
          select: {
            id: true,
            user: { select: { fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const seen = new Set<string>();
    const alreadyAssigned = [];
    for (const r of rows) {
      if (seen.has(r.intern.id)) continue;
      seen.add(r.intern.id);
      alreadyAssigned.push({
        internId: r.intern.id,
        fullName: r.intern.user.fullName,
        email: r.intern.user.email,
        lastForDate: r.forDate.toISOString().slice(0, 10),
      });
    }

    res.json({
      alreadyAssigned,
      count: alreadyAssigned.length,
      targetCount: targetInternIds.length,
      message:
        alreadyAssigned.length > 0
          ? `Already assigned to ${alreadyAssigned.length} of ${targetInternIds.length} selected intern(s).`
          : null,
    });
  },
);

router.post("/library", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    description: z.string().min(5),
    libraryOrder: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Title and description required" });

  let libraryOrder = parsed.data.libraryOrder;
  if (!libraryOrder) {
    const maxRow = await prisma.task.aggregate({
      where: { isLibrary: true },
      _max: { libraryOrder: true },
    });
    libraryOrder = (maxRow._max.libraryOrder || 0) + 1;
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title.trim(),
      description: parsed.data.description,
      isLibrary: true,
      libraryOrder,
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ task });
});

router.post("/:taskId/assign", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    forDate: z.string().min(8),
    groupId: z.string().optional(),
    internIds: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "forDate required" });

  const libraryOrTask = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!libraryOrTask) return res.status(404).json({ message: "Task not found" });

  const deny = await assertTrainerTargets(
    req.user!.role,
    req.user!.id,
    parsed.data.groupId,
    parsed.data.internIds,
  );
  if (deny) return res.status(403).json({ message: deny });

  const targetInternIds = await resolveInternIds(parsed.data.groupId, parsed.data.internIds);
  if (targetInternIds.length === 0) {
    return res.status(400).json({ message: "Select a group and/or interns" });
  }

  // Trainer: every target intern must be in their groups
  if (req.user!.role === "TRAINER") {
    for (const iid of targetInternIds) {
      const ok = await trainerCanAccessIntern(req.user!.id, iid);
      if (!ok) return res.status(403).json({ message: "Cannot assign outside your groups" });
    }
  }

  /**
   * Library templates stay reusable. Each "Assign from library" creates a fresh Task
   * copy so the same template can be assigned again on a new date/group
   * (@@unique([taskId, internId]) would otherwise skip everyone).
   */
  const task = libraryOrTask.isLibrary
    ? await prisma.task.create({
        data: {
          title: libraryOrTask.title,
          description: libraryOrTask.description,
          isLibrary: false,
          sourceLibraryId: libraryOrTask.id,
          groupId: parsed.data.groupId || null,
          createdById: req.user!.id,
        },
      })
    : libraryOrTask;

  if (!libraryOrTask.isLibrary && parsed.data.groupId) {
    await prisma.task.update({
      where: { id: task.id },
      data: { groupId: parsed.data.groupId },
    });
  }

  // Who already received this library template (any prior clone)?
  let alreadyAssigned: {
    internId: string;
    fullName: string;
    email: string;
    lastForDate: string;
  }[] = [];
  if (libraryOrTask.isLibrary) {
    const prior = await prisma.taskAssignment.findMany({
      where: {
        internId: { in: targetInternIds },
        task: {
          OR: [{ id: libraryOrTask.id }, { sourceLibraryId: libraryOrTask.id }],
          // exclude the fresh clone we just created (no assignments yet)
          NOT: { id: task.id },
        },
      },
      select: {
        forDate: true,
        intern: { select: { id: true, user: { select: { fullName: true, email: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    const seen = new Set<string>();
    for (const r of prior) {
      if (seen.has(r.intern.id)) continue;
      seen.add(r.intern.id);
      alreadyAssigned.push({
        internId: r.intern.id,
        fullName: r.intern.user.fullName,
        email: r.intern.user.email,
        lastForDate: r.forDate.toISOString().slice(0, 10),
      });
    }
  }

  const forDate = toDayDate(parsed.data.forDate);
  const { created, skipped } = await assignTaskToInterns(task.id, task.title, forDate, targetInternIds);

  if (created.length === 0) {
    // Clean up empty clone if nothing was assigned
    if (libraryOrTask.isLibrary && task.id !== libraryOrTask.id) {
      await prisma.task.delete({ where: { id: task.id } }).catch(() => undefined);
    }
    return res.status(400).json({
      message:
        alreadyAssigned.length > 0
          ? `Already assigned earlier to all ${alreadyAssigned.length} selected intern(s). Open Manage to review, or pick another date/group.`
          : `Already assigned to all ${skipped.length} selected intern(s). Open Manage → that group to review the existing task.`,
      assignedCount: 0,
      skippedCount: skipped.length,
      alreadyAssigned,
      alreadyAssignedCount: alreadyAssigned.length,
    });
  }

  res.status(201).json({
    task,
    fromLibrary: libraryOrTask.isLibrary,
    assignments: created,
    assignedCount: created.length,
    skippedCount: skipped.length,
    alreadyAssigned,
    alreadyAssignedCount: alreadyAssigned.length,
    warning:
      alreadyAssigned.length > 0
        ? `Note: ${alreadyAssigned.length} intern(s) already had this library task before (still assigned again for ${parsed.data.forDate}).`
        : null,
  });
});

router.post("/", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().min(5).optional(),
    libraryTaskId: z.string().optional(),
    forDate: z.string().min(8),
    dueDate: z.string().optional(),
    groupId: z.string().optional(),
    internIds: z.array(z.string()).optional(),
    alsoSaveToLibrary: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload — forDate required" });

  const deny = await assertTrainerTargets(
    req.user!.role,
    req.user!.id,
    parsed.data.groupId,
    parsed.data.internIds,
  );
  if (deny) return res.status(403).json({ message: deny });

  const targetInternIds = await resolveInternIds(parsed.data.groupId, parsed.data.internIds);
  if (targetInternIds.length === 0) {
    return res.status(400).json({ message: "Select a group and/or interns" });
  }

  if (req.user!.role === "TRAINER") {
    for (const iid of targetInternIds) {
      const ok = await trainerCanAccessIntern(req.user!.id, iid);
      if (!ok) return res.status(403).json({ message: "Cannot assign outside your groups" });
    }
  }

  const forDate = toDayDate(parsed.data.forDate);

  let task;
  if (parsed.data.libraryTaskId) {
    task = await prisma.task.findUnique({ where: { id: parsed.data.libraryTaskId } });
    if (!task) return res.status(404).json({ message: "Library task not found" });
  } else {
    if (!parsed.data.title || !parsed.data.description) {
      return res.status(400).json({ message: "title and description required (or pick libraryTaskId)" });
    }
    task = await prisma.task.create({
      data: {
        title: parsed.data.title.trim(),
        description: parsed.data.description,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : forDate,
        groupId: parsed.data.groupId || null,
        isLibrary: !!parsed.data.alsoSaveToLibrary,
        createdById: req.user!.id,
      },
    });
  }

  const { created, skipped } = await assignTaskToInterns(task.id, task.title, forDate, targetInternIds);

  res.status(201).json({
    task,
    assignments: created,
    assignedCount: created.length,
    skippedCount: skipped.length,
  });
});

router.patch("/:taskId", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().min(5).optional(),
    dueDate: z.string().nullable().optional(),
    isLibrary: z.boolean().optional(),
    libraryOrder: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  try {
    const task = await prisma.task.update({
      where: { id: req.params.taskId },
      data: {
        ...(parsed.data.title ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
        ...(parsed.data.dueDate !== undefined
          ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
          : {}),
        ...(parsed.data.isLibrary !== undefined ? { isLibrary: parsed.data.isLibrary } : {}),
        ...(parsed.data.libraryOrder !== undefined ? { libraryOrder: parsed.data.libraryOrder } : {}),
      },
    });
    res.json({ task });
  } catch {
    res.status(404).json({ message: "Task not found" });
  }
});

router.delete("/:taskId", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.taskId } });
    res.json({ message: "Task deleted" });
  } catch {
    res.status(404).json({ message: "Task not found" });
  }
});

router.delete("/assignments/:id", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  try {
    const assignment = await prisma.taskAssignment.findUnique({ where: { id: req.params.id } });
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (req.user!.role === "TRAINER") {
      const ok = await trainerCanAccessIntern(req.user!.id, assignment.internId);
      if (!ok) return res.status(403).json({ message: "Not your group intern" });
    }
    await prisma.taskAssignment.delete({ where: { id: req.params.id } });
    res.json({ message: "Assignment removed" });
  } catch {
    res.status(404).json({ message: "Assignment not found" });
  }
});

router.post("/assignments/:id/submit", requireRole("INTERN"), async (req, res) => {
  const schema = z.object({
    projectDetails: z.string().trim().min(5, "Write at least a short project summary (5+ characters)"),
    githubUrl: z.string().url("Enter a valid GitHub URL (https://...)"),
    liveUrl: z.union([z.string().url(), z.literal("")]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const first =
      parsed.error.flatten().fieldErrors.projectDetails?.[0] ||
      parsed.error.flatten().fieldErrors.githubUrl?.[0] ||
      parsed.error.flatten().fieldErrors.liveUrl?.[0] ||
      "Invalid submission";
    return res.status(400).json({ message: first, errors: parsed.error.flatten() });
  }

  const iid = await internProfileId(req.user!.id);
  const assignment = await prisma.taskAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment || assignment.internId !== iid) {
    return res.status(404).json({ message: "Assignment not found" });
  }
  if (assignment.status === TaskStatus.DONE) {
    return res.status(400).json({ message: "Already marked done" });
  }

  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.submission.upsert({
      where: { assignmentId: assignment.id },
      update: {
        projectDetails: parsed.data.projectDetails,
        githubUrl: parsed.data.githubUrl,
        liveUrl: parsed.data.liveUrl || null,
        submittedAt: new Date(),
      },
      create: {
        assignmentId: assignment.id,
        projectDetails: parsed.data.projectDetails,
        githubUrl: parsed.data.githubUrl,
        liveUrl: parsed.data.liveUrl || null,
      },
    });
    await tx.taskAssignment.update({
      where: { id: assignment.id },
      data: { status: TaskStatus.SUBMITTED },
    });
    return sub;
  });

  res.json({ submission, status: TaskStatus.SUBMITTED });
});

router.post("/assignments/:id/review", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    comment: z.string().min(2),
    status: z.enum(["DONE", "NEEDS_IMPROVEMENT"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid review" });

  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: req.params.id },
    include: { submission: true },
  });
  if (!assignment?.submission) {
    return res.status(400).json({ message: "No submission to review" });
  }

  if (req.user!.role === "TRAINER") {
    const ok = await trainerCanAccessIntern(req.user!.id, assignment.internId);
    if (!ok) return res.status(403).json({ message: "You can only review interns in your groups" });
  }

  const newStatus = parsed.data.status as TaskStatus;

  await prisma.$transaction(async (tx) => {
    await tx.feedback.create({
      data: {
        submissionId: assignment.submission!.id,
        reviewerId: req.user!.id,
        comment: parsed.data.comment,
        newStatus,
      },
    });
    await tx.taskAssignment.update({
      where: { id: assignment.id },
      data: { status: newStatus },
    });
  });

  res.json({ message: "Reviewed", status: newStatus });
});

export default router;
