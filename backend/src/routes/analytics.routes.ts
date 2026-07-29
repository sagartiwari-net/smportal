import { Router } from "express";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeInternPerformance } from "../services/performance";

const router = Router();
router.use(requireAuth);

const TABS = ["overview", "tasks", "attendance", "colleges", "leaderboard"] as const;
type Tab = (typeof TABS)[number];

async function scopedInterns(userId: string, role: string) {
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId } });
    return prisma.internProfile.findMany({
      where: { collegeId: profile?.collegeId || "" },
      include: { user: { select: { id: true, fullName: true, email: true } }, college: true },
    });
  }
  if (role === "TRAINER") {
    return prisma.internProfile.findMany({
      where: { memberships: { some: { isActive: true, group: { trainerId: userId } } } },
      include: { user: { select: { id: true, fullName: true, email: true } }, college: true },
    });
  }
  return prisma.internProfile.findMany({
    include: { user: { select: { id: true, fullName: true, email: true } }, college: true },
  });
}

type Row = Awaited<ReturnType<typeof buildRows>>[number];

async function buildRows(interns: Awaited<ReturnType<typeof scopedInterns>>) {
  return Promise.all(
    interns.map(async (i) => {
      const perf = await computeInternPerformance(i.id);
      const activeGroup = await prisma.groupMember.findFirst({
        where: { internId: i.id, isActive: true },
        include: { group: true },
      });
      return {
        ...perf,
        fullName: i.user.fullName,
        email: i.user.email,
        college: i.college?.name || "Unassigned",
        collegeId: i.collegeId || null,
        groupName: activeGroup?.group.name || "Unassigned",
        groupId: activeGroup?.group.id || null,
      };
    }),
  );
}

function applyRowFilters(
  rows: Row[],
  q: {
    college?: string;
    group?: string;
    search?: string;
    minScore?: number;
    maxScore?: number;
    minAttendance?: number;
    maxAttendance?: number;
    minTasks?: number;
    maxTasks?: number;
  },
) {
  return rows.filter((r) => {
    if (q.college && q.college !== "all" && r.college !== q.college) return false;
    if (q.group && q.group !== "all" && r.groupName !== q.group) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!r.fullName.toLowerCase().includes(s) && !r.email.toLowerCase().includes(s)) return false;
    }
    if (q.minScore != null && !Number.isNaN(q.minScore) && r.score < q.minScore) return false;
    if (q.maxScore != null && !Number.isNaN(q.maxScore) && r.score > q.maxScore) return false;
    if (q.minAttendance != null && !Number.isNaN(q.minAttendance) && r.attendanceRate < q.minAttendance) return false;
    if (q.maxAttendance != null && !Number.isNaN(q.maxAttendance) && r.attendanceRate > q.maxAttendance) return false;
    if (q.minTasks != null && !Number.isNaN(q.minTasks) && r.taskCompletionRate < q.minTasks) return false;
    if (q.maxTasks != null && !Number.isNaN(q.maxTasks) && r.taskCompletionRate > q.maxTasks) return false;
    return true;
  });
}

function parseNum(v: unknown) {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseFilters(query: Record<string, unknown>) {
  return {
    college: typeof query.college === "string" ? query.college : "all",
    group: typeof query.group === "string" ? query.group : "all",
    search: typeof query.search === "string" ? query.search : "",
    minScore: parseNum(query.minScore),
    maxScore: parseNum(query.maxScore),
    minAttendance: parseNum(query.minAttendance),
    maxAttendance: parseNum(query.maxAttendance),
    minTasks: parseNum(query.minTasks),
    maxTasks: parseNum(query.maxTasks),
    from: typeof query.from === "string" ? query.from : "",
    to: typeof query.to === "string" ? query.to : "",
    sort: typeof query.sort === "string" ? query.sort : "score_desc",
  };
}

function sortRows(rows: Row[], sort: string) {
  return rows.slice().sort((a, b) => {
    switch (sort) {
      case "score_asc":
        return a.score - b.score;
      case "attendance_desc":
        return b.attendanceRate - a.attendanceRate;
      case "attendance_asc":
        return a.attendanceRate - b.attendanceRate;
      case "tasks_desc":
        return b.taskCompletionRate - a.taskCompletionRate;
      case "tasks_asc":
        return a.taskCompletionRate - b.taskCompletionRate;
      case "name_asc":
        return a.fullName.localeCompare(b.fullName);
      case "name_desc":
        return b.fullName.localeCompare(a.fullName);
      case "score_desc":
      default:
        return b.score - a.score;
    }
  });
}

function dateFilterFrom(filters: { from: string; to: string }) {
  if (!filters.from && !filters.to) return undefined;
  return {
    ...(filters.from ? { gte: new Date(filters.from + "T00:00:00.000Z") } : {}),
    ...(filters.to ? { lte: new Date(filters.to + "T23:59:59.999Z") } : {}),
  };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page: safePage, pageSize, total, totalPages },
  };
}

function summaryFromRows(rows: Row[], extra?: { totalAssignments?: number; totalAttendanceRows?: number }) {
  const avgScore = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
  const avgAttendance = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.attendanceRate, 0) / rows.length)
    : 0;
  const avgTasks = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.taskCompletionRate, 0) / rows.length)
    : 0;
  return {
    count: rows.length,
    avgScore,
    avgAttendance,
    avgTasks,
    totalAssignments: extra?.totalAssignments ?? 0,
    totalAttendanceRows: extra?.totalAttendanceRows ?? 0,
  };
}

/** Lightweight filter dropdown options (no heavy performance calc) */
router.get("/filter-options", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const interns = await scopedInterns(req.user!.id, req.user!.role);
  const collegeOptions = [...new Set(interns.map((i) => i.college?.name || "Unassigned"))].sort();

  const ids = interns.map((i) => i.id);
  const memberships = ids.length
    ? await prisma.groupMember.findMany({
        where: { internId: { in: ids }, isActive: true },
        include: { group: { select: { name: true } } },
      })
    : [];
  const groupOptions = [...new Set(memberships.map((m) => m.group.name || "Unassigned"))].sort();

  res.json({ collegeOptions, groupOptions });
});

router.get("/interns", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const interns = await scopedInterns(req.user!.id, req.user!.role);
  let rows = await buildRows(interns);
  rows = applyRowFilters(rows, parseFilters(req.query as Record<string, unknown>));
  res.json({
    summary: summaryFromRows(rows),
    interns: sortRows(rows, "score_desc"),
  });
});

/**
 * Tabbed analytics — only computes data for requested tab.
 * Query: tab=overview|tasks|attendance|colleges|leaderboard&page&pageSize&filters…
 */
router.get("/dashboard", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const tabRaw = typeof req.query.tab === "string" ? req.query.tab : "overview";
  const tab: Tab = (TABS as readonly string[]).includes(tabRaw) ? (tabRaw as Tab) : "overview";
  const page = Math.max(1, parseNum(req.query.page) ?? 1);
  const pageSize = Math.min(50, Math.max(5, parseNum(req.query.pageSize) ?? 10));

  const interns = await scopedInterns(req.user!.id, req.user!.role);
  const allRows = await buildRows(interns);
  const collegeOptions = [...new Set(allRows.map((r) => r.college))].sort();
  const groupOptions = [...new Set(allRows.map((r) => r.groupName))].sort();

  const filters = parseFilters(req.query as Record<string, unknown>);
  let rows = sortRows(applyRowFilters(allRows, filters), filters.sort);
  const internIds = rows.map((r) => r.internId);
  const dateFilter = dateFilterFrom(filters);

  const base = {
    tab,
    filters: { ...filters, collegeOptions, groupOptions },
    summary: summaryFromRows(rows),
  };

  if (tab === "overview") {
    return res.json({
      ...base,
      charts: {
        topInterns: rows.slice(0, 10).map((r) => ({
          name: r.fullName.split(" ")[0],
          fullName: r.fullName,
          score: r.score,
          attendance: r.attendanceRate,
          tasks: r.taskCompletionRate,
        })),
      },
    });
  }

  if (tab === "tasks") {
    const assignments = internIds.length
      ? await prisma.taskAssignment.findMany({
          where: {
            internId: { in: internIds },
            ...(dateFilter ? { forDate: dateFilter } : {}),
          },
          select: { status: true },
        })
      : [];
    const taskStatus = { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
    for (const a of assignments) taskStatus[a.status] += 1;

    return res.json({
      ...base,
      summary: summaryFromRows(rows, { totalAssignments: assignments.length }),
      charts: { taskStatus },
    });
  }

  if (tab === "attendance") {
    const attendance = internIds.length
      ? await prisma.attendance.findMany({
          where: {
            internId: { in: internIds },
            ...(dateFilter ? { date: dateFilter } : {}),
          },
          select: { status: true, date: true },
          orderBy: { date: "asc" },
        })
      : [];

    const byDate = new Map<string, { present: number; counted: number; absent: number; leave: number }>();
    for (const a of attendance) {
      if (a.status === "WEEK_OFF") continue;
      const key = a.date.toISOString().slice(0, 10);
      const cur = byDate.get(key) || { present: 0, counted: 0, absent: 0, leave: 0 };
      cur.counted += 1;
      if (a.status === "PRESENT") cur.present += 1;
      if (a.status === "ABSENT") cur.absent += 1;
      if (a.status === "LEAVE") cur.leave += 1;
      byDate.set(key, cur);
    }
    const attendanceTrend = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        rate: v.counted ? Math.round((v.present / v.counted) * 100) : 0,
        present: v.present,
        absent: v.absent,
        leave: v.leave,
        total: v.counted,
      }));

    const paged = paginate(attendanceTrend, page, pageSize);

    return res.json({
      ...base,
      summary: summaryFromRows(rows, { totalAttendanceRows: attendance.length }),
      charts: { attendanceTrend },
      table: { rows: paged.items, pagination: paged.pagination },
    });
  }

  if (tab === "colleges") {
    const byCollegeMap = new Map<string, { scores: number[]; att: number[]; tasks: number[]; n: number }>();
    for (const r of rows) {
      const c = r.college || "Unassigned";
      const cur = byCollegeMap.get(c) || { scores: [], att: [], tasks: [], n: 0 };
      cur.scores.push(r.score);
      cur.att.push(r.attendanceRate);
      cur.tasks.push(r.taskCompletionRate);
      cur.n += 1;
      byCollegeMap.set(c, cur);
    }
    const byCollege = [...byCollegeMap.entries()].map(([name, v]) => ({
      name,
      count: v.n,
      avgScore: Math.round(v.scores.reduce((a, b) => a + b, 0) / v.n),
      avgAttendance: Math.round(v.att.reduce((a, b) => a + b, 0) / v.n),
      avgTasks: Math.round(v.tasks.reduce((a, b) => a + b, 0) / v.n),
    }));

    const byGroupMap = new Map<string, { scores: number[]; done: number; total: number; n: number }>();
    for (const r of rows) {
      const g = r.groupName || "Unassigned";
      const cur = byGroupMap.get(g) || { scores: [], done: 0, total: 0, n: 0 };
      cur.scores.push(r.score);
      cur.done += r.doneTasks;
      cur.total += r.totalTasks;
      cur.n += 1;
      byGroupMap.set(g, cur);
    }
    const byGroup = [...byGroupMap.entries()].map(([name, v]) => ({
      name,
      count: v.n,
      avgScore: Math.round(v.scores.reduce((a, b) => a + b, 0) / v.n),
      tasksDone: v.done,
      tasksTotal: v.total,
    }));

    return res.json({
      ...base,
      charts: { byCollege, byGroup },
    });
  }

  // leaderboard
  const paged = paginate(rows, page, pageSize);
  return res.json({
    ...base,
    interns: paged.items,
    pagination: paged.pagination,
    charts: {
      topInterns: rows.slice(0, 10).map((r) => ({
        name: r.fullName.split(" ")[0],
        fullName: r.fullName,
        score: r.score,
        attendance: r.attendanceRate,
        tasks: r.taskCompletionRate,
      })),
    },
  });
});

/**
 * Drill-down: college or group detail with interns, tasks, attendance charts.
 * Query: type=college|group&name=Demo College
 */
router.get("/detail", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if ((type !== "college" && type !== "group") || !name) {
    return res.status(400).json({ message: "type=college|group and name are required" });
  }

  const interns = await scopedInterns(req.user!.id, req.user!.role);
  const allRows = await buildRows(interns);
  const scoped = allRows.filter((r) =>
    type === "college" ? r.college === name : r.groupName === name,
  );
  const sorted = sortRows(scoped, "score_desc");
  const internIds = sorted.map((r) => r.internId);

  const assignments = internIds.length
    ? await prisma.taskAssignment.findMany({
        where: { internId: { in: internIds } },
        include: {
          task: { select: { title: true } },
          intern: { include: { user: { select: { fullName: true, email: true } } } },
        },
        orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
      })
    : [];

  const taskStatus = { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
  for (const a of assignments) taskStatus[a.status] += 1;

  // Per-intern work snapshot
  const workByIntern = new Map<
    string,
    { done: number; submitted: number; needs: number; assigned: number; titles: string[] }
  >();
  for (const a of assignments) {
    const cur = workByIntern.get(a.internId) || {
      done: 0,
      submitted: 0,
      needs: 0,
      assigned: 0,
      titles: [],
    };
    if (a.status === "DONE") cur.done += 1;
    else if (a.status === "SUBMITTED") cur.submitted += 1;
    else if (a.status === "NEEDS_IMPROVEMENT") cur.needs += 1;
    else cur.assigned += 1;
    if (cur.titles.length < 4) {
      cur.titles.push(`Day ${a.dayNumber} · Task ${a.taskNumber}: ${a.task.title} (${a.status})`);
    }
    workByIntern.set(a.internId, cur);
  }

  const attendance = internIds.length
    ? await prisma.attendance.findMany({
        where: { internId: { in: internIds } },
        select: { status: true, date: true },
        orderBy: { date: "asc" },
      })
    : [];

  const byDate = new Map<string, { present: number; counted: number }>();
  for (const a of attendance) {
    if (a.status === "WEEK_OFF") continue;
    const key = a.date.toISOString().slice(0, 10);
    const cur = byDate.get(key) || { present: 0, counted: 0 };
    cur.counted += 1;
    if (a.status === "PRESENT") cur.present += 1;
    byDate.set(key, cur);
  }
  const attendanceTrend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      rate: v.counted ? Math.round((v.present / v.counted) * 100) : 0,
      present: v.present,
      total: v.counted,
    }));

  const recentWork = assignments.slice(0, 40).map((a) => ({
    internName: a.intern.user.fullName,
    email: a.intern.user.email,
    title: a.task.title,
    dayNumber: a.dayNumber,
    taskNumber: a.taskNumber,
    status: a.status,
    forDate: a.forDate,
  }));

  res.json({
    type,
    name,
    summary: summaryFromRows(sorted, {
      totalAssignments: assignments.length,
      totalAttendanceRows: attendance.length,
    }),
    charts: {
      taskStatus,
      attendanceTrend,
      internBars: sorted.map((r) => ({
        name: r.fullName.split(" ")[0],
        fullName: r.fullName,
        score: r.score,
        attendance: r.attendanceRate,
        tasks: r.taskCompletionRate,
      })),
    },
    interns: sorted.map((r) => {
      const w = workByIntern.get(r.internId);
      return {
        ...r,
        work: w
          ? {
              done: w.done,
              submitted: w.submitted,
              needsImprovement: w.needs,
              assigned: w.assigned,
              recentTitles: w.titles,
            }
          : { done: 0, submitted: 0, needsImprovement: 0, assigned: 0, recentTitles: [] },
      };
    }),
    recentWork,
  });
});

router.get("/me", requireRole("INTERN"), async (req, res) => {
  const me = await prisma.internProfile.findUnique({
    where: { userId: req.user!.id },
    include: {
      user: { select: { fullName: true, email: true } },
      college: true,
    },
  });
  if (!me) return res.status(404).json({ message: "Intern profile not found" });

  const perf = await computeInternPerformance(me.id);
  const activeGroup = await prisma.groupMember.findFirst({
    where: { internId: me.id, isActive: true },
    include: { group: true },
  });

  const recentAttendance = await prisma.attendance.findMany({
    where: { internId: me.id },
    orderBy: { date: "desc" },
    take: 14,
  });

  res.json({
    performance: {
      ...perf,
      fullName: me.user.fullName,
      email: me.user.email,
      college: me.college?.name || null,
      groupName: activeGroup?.group.name || null,
    },
    recentAttendance: recentAttendance.map((a) => ({
      date: a.date,
      status: a.status,
    })),
  });
});

router.get("/interns/:internId", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE", "INTERN"), async (req, res) => {
  if (req.user!.role === "INTERN") {
    const me = await prisma.internProfile.findUnique({ where: { userId: req.user!.id } });
    if (me?.id !== req.params.internId) return res.status(403).json({ message: "Forbidden" });
  }
  const perf = await computeInternPerformance(req.params.internId);
  res.json({ performance: perf });
});

export default router;
