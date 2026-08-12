import { Router } from "express";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeInternPerformance } from "../services/performance";
import {
  buildAnalyticsDayExcel,
  buildFullAnalyticsExcel,
  buildFullAnalyticsPrintPayload,
  type FullAnalyticsPayload,
} from "../services/analyticsExcelExport";
import { buildInternExcelWorkbook } from "../services/internExcelExport";

const router = Router();
router.use(requireAuth);

function dayUtc(input: string) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

const TABS = ["overview", "tasks", "attendance", "colleges", "leaderboard"] as const;
type Tab = (typeof TABS)[number];

async function scopedInterns(userId: string, role: string) {
  const approved = { approvalStatus: "APPROVED" as const };
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId } });
    return prisma.internProfile.findMany({
      where: { collegeId: profile?.collegeId || "", ...approved },
      include: { user: { select: { id: true, fullName: true, email: true } }, college: true },
    });
  }
  if (role === "TRAINER") {
    return prisma.internProfile.findMany({
      where: {
        ...approved,
        memberships: { some: { isActive: true, group: { trainerId: userId } } },
      },
      include: { user: { select: { id: true, fullName: true, email: true } }, college: true },
    });
  }
  return prisma.internProfile.findMany({
    where: approved,
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

/** Full DB-backed analytics payload — all sheets for Excel / print */
async function gatherFullAnalyticsPayload(
  sorted: Row[],
  filters: ReturnType<typeof parseFilters>,
): Promise<FullAnalyticsPayload> {
  const internIds = sorted.map((r) => r.internId);
  const rowById = new Map(sorted.map((r) => [r.internId, r]));
  const dateWhere = dateFilterFrom(filters);

  const [assignments, attendance] = await Promise.all([
    internIds.length
      ? prisma.taskAssignment.findMany({
          where: {
            internId: { in: internIds },
            ...(dateWhere ? { forDate: dateWhere } : {}),
          },
          include: {
            task: { select: { title: true } },
            intern: {
              include: {
                user: { select: { fullName: true, email: true } },
                college: { select: { name: true } },
              },
            },
          },
          orderBy: [{ forDate: "desc" }, { dayNumber: "asc" }, { taskNumber: "asc" }],
        })
      : Promise.resolve([]),
    internIds.length
      ? prisma.attendance.findMany({
          where: {
            internId: { in: internIds },
            ...(dateWhere ? { date: dateWhere } : {}),
          },
          include: {
            intern: {
              include: {
                user: { select: { fullName: true, email: true } },
                college: { select: { name: true } },
              },
            },
            markedBy: { select: { fullName: true, role: true } },
          },
          orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  const taskStatus = { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
  for (const a of assignments) taskStatus[a.status] += 1;

  const attendanceCounts = { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 };
  const dayMap = new Map<
    string,
    { date: string; present: number; absent: number; leave: number; weekOff: number; total: number }
  >();

  const attendanceDetails = attendance.map((r) => {
    const key = r.date.toISOString().slice(0, 10);
    const d = dayMap.get(key) || {
      date: key,
      present: 0,
      absent: 0,
      leave: 0,
      weekOff: 0,
      total: 0,
    };
    d.total += 1;
    if (r.status === "PRESENT") {
      d.present += 1;
      attendanceCounts.PRESENT += 1;
    } else if (r.status === "ABSENT") {
      d.absent += 1;
      attendanceCounts.ABSENT += 1;
    } else if (r.status === "LEAVE") {
      d.leave += 1;
      attendanceCounts.LEAVE += 1;
    } else if (r.status === "WEEK_OFF") {
      d.weekOff += 1;
      attendanceCounts.WEEK_OFF += 1;
    }
    dayMap.set(key, d);
    const perf = rowById.get(r.internId);
    return {
      date: key,
      student: r.intern.user.fullName,
      email: r.intern.user.email,
      college: perf?.college || r.intern.college?.name || "—",
      group: perf?.groupName || "—",
      status: String(r.status),
      markedBy: r.markedBy
        ? `${r.markedBy.fullName}${r.markedBy.role ? ` (${r.markedBy.role})` : ""}`
        : "—",
    };
  });

  const attendanceDays = [...dayMap.values()]
    .map((d) => {
      const counted = d.present + d.absent + d.leave;
      return {
        ...d,
        presentPct: counted ? Math.round((d.present / counted) * 100) : 0,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const byCollegeMap = new Map<
    string,
    { n: number; scores: number[]; att: number[]; tasks: number[]; done: number; total: number }
  >();
  const byGroupMap = new Map<
    string,
    { n: number; scores: number[]; att: number[]; tasks: number[]; done: number; total: number }
  >();
  for (const r of sorted) {
    const c = byCollegeMap.get(r.college) || { n: 0, scores: [], att: [], tasks: [], done: 0, total: 0 };
    c.n += 1;
    c.scores.push(r.score);
    c.att.push(r.attendanceRate);
    c.tasks.push(r.taskCompletionRate);
    c.done += r.doneTasks;
    c.total += r.totalTasks;
    byCollegeMap.set(r.college, c);

    const g = byGroupMap.get(r.groupName) || { n: 0, scores: [], att: [], tasks: [], done: 0, total: 0 };
    g.n += 1;
    g.scores.push(r.score);
    g.att.push(r.attendanceRate);
    g.tasks.push(r.taskCompletionRate);
    g.done += r.doneTasks;
    g.total += r.totalTasks;
    byGroupMap.set(r.groupName, g);
  }

  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  const filterLabel = [
    "Full analytics report",
    filters.college !== "all" ? `College: ${filters.college}` : null,
    filters.group !== "all" ? `Group: ${filters.group}` : null,
    filters.from || filters.to ? `Dates: ${filters.from || "…"} → ${filters.to || "…"}` : null,
    filters.search ? `Search: ${filters.search}` : null,
    `${sorted.length} students`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    filterLabel,
    summary: {
      students: sorted.length,
      avgScore: avg(sorted.map((r) => r.score)),
      avgAttendance: avg(sorted.map((r) => r.attendanceRate)),
      avgTasks: avg(sorted.map((r) => r.taskCompletionRate)),
      totalAssignments: assignments.length,
      totalAttendanceRows: attendance.length,
    },
    taskStatus,
    attendanceCounts,
    students: sorted.map((r, i) => ({
      rank: i + 1,
      fullName: r.fullName,
      email: r.email,
      college: r.college,
      groupName: r.groupName,
      score: r.score,
      attendanceRate: r.attendanceRate,
      taskCompletionRate: r.taskCompletionRate,
      doneTasks: r.doneTasks,
      totalTasks: r.totalTasks,
      present: r.present,
      absent: r.absent,
      leave: r.leave,
    })),
    tasks: assignments.map((a) => {
      const perf = rowById.get(a.internId);
      return {
        student: a.intern.user.fullName,
        email: a.intern.user.email,
        college: perf?.college || a.intern.college?.name || "—",
        group: perf?.groupName || "—",
        day: a.dayNumber,
        taskNo: a.taskNumber,
        title: a.task.title,
        forDate: a.forDate.toISOString().slice(0, 10),
        status: String(a.status),
      };
    }),
    attendanceDays,
    attendanceDetails,
    colleges: [...byCollegeMap.entries()]
      .map(([name, v]) => ({
        name,
        students: v.n,
        avgScore: avg(v.scores),
        avgAttendance: avg(v.att),
        avgTasks: avg(v.tasks),
        tasksDone: v.done,
        tasksTotal: v.total,
      }))
      .sort((a, b) => b.students - a.students),
    groups: [...byGroupMap.entries()]
      .map(([name, v]) => ({
        name,
        students: v.n,
        avgScore: avg(v.scores),
        avgAttendance: avg(v.att),
        avgTasks: avg(v.tasks),
        tasksDone: v.done,
        tasksTotal: v.total,
      }))
      .sort((a, b) => b.students - a.students),
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
          internId: r.internId,
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
 * Drill-down: college or group detail — lazy sections for faster load.
 * Query: type=college|group&name=…&section=summary|charts|students|related|work|all&page&pageSize
 */
router.get("/detail", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if ((type !== "college" && type !== "group") || !name) {
    return res.status(400).json({ message: "type=college|group and name are required" });
  }

  const sectionRaw = typeof req.query.section === "string" ? req.query.section : "summary";
  const section = ["summary", "charts", "students", "related", "work", "all"].includes(sectionRaw)
    ? sectionRaw
    : "summary";
  const page = Math.max(1, parseNum(req.query.page) ?? 1);
  const pageSize = Math.min(50, Math.max(10, parseNum(req.query.pageSize) ?? 20));

  const interns = await scopedInterns(req.user!.id, req.user!.role);
  const allRows = await buildRows(interns);
  const scoped = allRows.filter((r) =>
    type === "college" ? r.college === name : r.groupName === name,
  );
  const sorted = sortRows(scoped, "score_desc");
  const internIds = sorted.map((r) => r.internId);

  let groupMeta: { id: string; name: string; internshipStatus: string } | null = null;
  if (type === "group") {
    const g = await prisma.trainingGroup.findFirst({ where: { name, isActive: true } });
    if (g) groupMeta = { id: g.id, name: g.name, internshipStatus: g.internshipStatus };
  }

  const base = {
    type,
    name,
    groupMeta,
    summary: summaryFromRows(sorted),
  };

  const wantAll = section === "all";
  const wantCharts = section === "charts" || wantAll;
  const wantStudents = section === "students" || wantAll;
  const wantRelated = section === "related" || wantAll;
  const wantWork = section === "work" || wantAll;

  if (section === "summary") {
    return res.json(base);
  }

  let assignments: Awaited<ReturnType<typeof prisma.taskAssignment.findMany>> = [];
  if (wantCharts || wantStudents || wantWork) {
    assignments = internIds.length
      ? await prisma.taskAssignment.findMany({
          where: { internId: { in: internIds } },
          include: {
            task: { select: { title: true } },
            intern: { include: { user: { select: { fullName: true, email: true } } } },
          },
          orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
        })
      : [];
  }

  let charts: {
    taskStatus: Record<string, number>;
    attendanceTrend: { date: string; rate: number; present: number; total: number }[];
    internBars: { internId: string; name: string; fullName: string; score: number; attendance: number; tasks: number }[];
  } | undefined;

  if (wantCharts) {
    const taskStatus = { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
    for (const a of assignments) taskStatus[a.status] += 1;

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

    charts = {
      taskStatus,
      attendanceTrend,
      internBars: sorted.map((r) => ({
        internId: r.internId,
        name: r.fullName.split(" ")[0],
        fullName: r.fullName,
        score: r.score,
        attendance: r.attendanceRate,
        tasks: r.taskCompletionRate,
      })),
    };

    if (section === "charts") {
      return res.json({
        ...base,
        summary: summaryFromRows(sorted, {
          totalAssignments: assignments.length,
          totalAttendanceRows: attendance.length,
        }),
        charts,
      });
    }
  }

  let internsPayload: DetailPayload["interns"] | undefined;
  if (wantStudents) {
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

    const allInterns = sorted.map((r) => {
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
    });

    const paged = paginate(allInterns, page, pageSize);
    internsPayload = paged.items;
    if (section === "students") {
      return res.json({
        ...base,
        summary: summaryFromRows(sorted, { totalAssignments: assignments.length }),
        interns: paged.items,
        studentsPagination: paged.pagination,
      });
    }
  }

  let relatedGroups: DetailPayload["relatedGroups"];
  let relatedColleges: DetailPayload["relatedColleges"];
  if (wantRelated && internIds.length) {
    if (type === "college") {
      const memberships = await prisma.groupMember.findMany({
        where: { internId: { in: internIds }, isActive: true },
        include: { group: { select: { name: true } } },
      });
      const byGroup = new Map<string, Set<string>>();
      for (const m of memberships) {
        const gName = m.group.name || "Unassigned";
        if (!byGroup.has(gName)) byGroup.set(gName, new Set());
        byGroup.get(gName)!.add(m.internId);
      }
      relatedGroups = [...byGroup.entries()]
        .map(([gName, idSet]) => {
          const subset = sorted.filter((r) => idSet.has(r.internId));
          const n = subset.length || 1;
          return {
            name: gName,
            students: subset.length,
            avgScore: Math.round(subset.reduce((s, r) => s + r.score, 0) / n),
            avgAttendance: Math.round(subset.reduce((s, r) => s + r.attendanceRate, 0) / n),
            avgTasks: Math.round(subset.reduce((s, r) => s + r.taskCompletionRate, 0) / n),
          };
        })
        .sort((a, b) => b.students - a.students);
    } else {
      const byCollege = new Map<string, typeof sorted>();
      for (const r of sorted) {
        const cName = r.college || "Unassigned";
        if (!byCollege.has(cName)) byCollege.set(cName, []);
        byCollege.get(cName)!.push(r);
      }
      relatedColleges = [...byCollege.entries()]
        .map(([cName, subset]) => {
          const n = subset.length || 1;
          return {
            name: cName,
            students: subset.length,
            avgScore: Math.round(subset.reduce((s, r) => s + r.score, 0) / n),
            avgAttendance: Math.round(subset.reduce((s, r) => s + r.attendanceRate, 0) / n),
            avgTasks: Math.round(subset.reduce((s, r) => s + r.taskCompletionRate, 0) / n),
          };
        })
        .sort((a, b) => b.students - a.students);
    }

    if (section === "related") {
      return res.json({ ...base, relatedGroups, relatedColleges });
    }
  }

  let recentWork: DetailPayload["recentWork"];
  if (wantWork) {
    const allWork = assignments.map((a) => ({
      internId: a.internId,
      internName: a.intern.user.fullName,
      email: a.intern.user.email,
      title: a.task.title,
      dayNumber: a.dayNumber,
      taskNumber: a.taskNumber,
      status: a.status,
      forDate: a.forDate,
    }));
    const paged = paginate(allWork, page, pageSize);
    recentWork = paged.items;
    if (section === "work") {
      return res.json({
        ...base,
        recentWork: paged.items,
        workPagination: paged.pagination,
      });
    }
  }

  // section === 'all' — full payload (legacy)
  const attendance = internIds.length
    ? await prisma.attendance.findMany({
        where: { internId: { in: internIds } },
        select: { status: true, date: true },
        orderBy: { date: "asc" },
      })
    : [];

  res.json({
    ...base,
    summary: summaryFromRows(sorted, {
      totalAssignments: assignments.length,
      totalAttendanceRows: attendance.length,
    }),
    charts: charts ?? {
      taskStatus: { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
      attendanceTrend: [],
      internBars: sorted.map((r) => ({
        internId: r.internId,
        name: r.fullName.split(" ")[0],
        fullName: r.fullName,
        score: r.score,
        attendance: r.attendanceRate,
        tasks: r.taskCompletionRate,
      })),
    },
    interns:
      internsPayload ??
      sorted.map((r) => ({
        ...r,
        work: { done: 0, submitted: 0, needsImprovement: 0, assigned: 0, recentTitles: [] },
      })),
    relatedGroups,
    relatedColleges,
    recentWork: recentWork ?? assignments.slice(0, 40).map((a) => ({
      internId: a.internId,
      internName: a.intern.user.fullName,
      email: a.intern.user.email,
      title: a.task.title,
      dayNumber: a.dayNumber,
      taskNumber: a.taskNumber,
      status: a.status,
      forDate: a.forDate,
    })),
  });
});

/** @deprecated inline type helper for detail sections */
type DetailPayload = {
  type: "college" | "group";
  name: string;
  summary: ReturnType<typeof summaryFromRows>;
  charts: {
    taskStatus: Record<string, number>;
    attendanceTrend: { date: string; rate: number; present: number; total: number }[];
    internBars: { internId: string; name: string; fullName: string; score: number; attendance: number; tasks: number }[];
  };
  interns: InternRow[];
  relatedGroups?: { name: string; students: number; avgScore: number; avgAttendance: number; avgTasks: number }[];
  relatedColleges?: { name: string; students: number; avgScore: number; avgAttendance: number; avgTasks: number }[];
  recentWork: {
    internId?: string;
    internName: string;
    email: string;
    title: string;
    dayNumber: number;
    taskNumber: number;
    status: string;
    forDate: Date;
  }[];
};

/**
 * Day roster under analytics filters — click a date from Attendance tab.
 */
router.get("/day", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  if (!dateStr) return res.status(400).json({ message: "date is required (YYYY-MM-DD)" });

  const filters = parseFilters(req.query as Record<string, unknown>);
  const interns = await scopedInterns(req.user!.id, req.user!.role);
  let rows = await buildRows(interns);
  rows = applyRowFilters(rows, filters);
  const internIds = rows.map((r) => r.internId);
  const rowById = new Map(rows.map((r) => [r.internId, r]));

  if (!internIds.length) {
    return res.json({
      date: dateStr,
      counts: { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 },
      records: [],
      filterSummary: summaryFromRows([]),
    });
  }

  const date = dayUtc(dateStr);
  const records = await prisma.attendance.findMany({
    where: { date, internId: { in: internIds } },
    include: {
      intern: {
        include: {
          user: { select: { fullName: true, email: true } },
          college: { select: { name: true } },
        },
      },
      markedBy: { select: { fullName: true, role: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const mapped = records.map((r) => {
    const perf = rowById.get(r.internId);
    return {
      id: r.id,
      internId: r.internId,
      status: r.status,
      student: r.intern.user.fullName,
      email: r.intern.user.email,
      college: perf?.college || r.intern.college?.name || "Unassigned",
      groupName: perf?.groupName || "Unassigned",
      markedBy: r.markedBy
        ? `${r.markedBy.fullName}${r.markedBy.role ? ` (${r.markedBy.role})` : ""}`
        : "—",
      score: perf?.score ?? null,
      attendanceRate: perf?.attendanceRate ?? null,
    };
  });

  const counts = {
    PRESENT: mapped.filter((r) => r.status === "PRESENT").length,
    ABSENT: mapped.filter((r) => r.status === "ABSENT").length,
    LEAVE: mapped.filter((r) => r.status === "LEAVE").length,
    WEEK_OFF: mapped.filter((r) => r.status === "WEEK_OFF").length,
  };

  res.json({
    date: dateStr,
    counts,
    records: mapped,
    filterSummary: summaryFromRows(rows),
  });
});

/**
 * Excel export for analytics views.
 * type=full|overview|tasks|attendance|colleges|leaderboard → full multi-sheet workbook
 * type=college|group|day|intern → scoped drill export
 */
router.get("/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : "full";
  const filters = parseFilters(req.query as Record<string, unknown>);
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const internId = typeof req.query.internId === "string" ? req.query.internId : "";

  try {
    if (type === "intern") {
      if (!internId) return res.status(400).json({ message: "internId required" });
      if (req.user!.role === "TRAINER") {
        const ok = await prisma.groupMember.findFirst({
          where: {
            internId,
            isActive: true,
            group: { trainerId: req.user!.id },
          },
        });
        if (!ok) return res.status(403).json({ message: "Not your intern" });
      }
      if (req.user!.role === "COLLEGE") {
        const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
        const intern = await prisma.internProfile.findUnique({
          where: { id: internId },
          select: { collegeId: true },
        });
        if (!intern || intern.collegeId !== profile?.collegeId) {
          return res.status(403).json({ message: "Not your college intern" });
        }
      }
      const { buffer, filename } = await buildInternExcelWorkbook(internId);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    const interns = await scopedInterns(req.user!.id, req.user!.role);
    let rows = await buildRows(interns);
    rows = applyRowFilters(rows, filters);

    if (type === "college" || type === "group") {
      if (!name) return res.status(400).json({ message: "name required" });
      rows = rows.filter((r) => (type === "college" ? r.college === name : r.groupName === name));
    }

    const internIds = rows.map((r) => r.internId);
    const sorted = sortRows(rows, filters.sort || "score_desc");

    if (type === "day") {
      if (!dateStr) return res.status(400).json({ message: "date required" });
      const date = dayUtc(dateStr);
      const records = internIds.length
        ? await prisma.attendance.findMany({
            where: { date, internId: { in: internIds } },
            include: {
              intern: {
                include: {
                  user: { select: { fullName: true, email: true } },
                  college: { select: { name: true } },
                },
              },
              markedBy: { select: { fullName: true, role: true } },
            },
          })
        : [];
      const rowById = new Map(rows.map((r) => [r.internId, r]));
      const mapped = records.map((r) => {
        const perf = rowById.get(r.internId);
        return {
          student: r.intern.user.fullName,
          email: r.intern.user.email,
          group: perf?.groupName || "—",
          college: perf?.college || r.intern.college?.name || "—",
          status: String(r.status),
          markedBy: r.markedBy
            ? `${r.markedBy.fullName}${r.markedBy.role ? ` (${r.markedBy.role})` : ""}`
            : "—",
        };
      });
      const counts = {
        PRESENT: mapped.filter((r) => r.status === "PRESENT").length,
        ABSENT: mapped.filter((r) => r.status === "ABSENT").length,
        LEAVE: mapped.filter((r) => r.status === "LEAVE").length,
        WEEK_OFF: mapped.filter((r) => r.status === "WEEK_OFF").length,
      };
      const filterBits = [
        filters.college !== "all" ? `College: ${filters.college}` : null,
        filters.group !== "all" ? `Group: ${filters.group}` : null,
      ].filter(Boolean);
      const { buffer, filename } = await buildAnalyticsDayExcel({
        date: dateStr,
        filterLabel: filterBits.join(" · ") || "All scoped students",
        counts,
        rows: mapped,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    // Full multi-sheet report (default for main Analytics export + college/group drills)
    const fullTypes = new Set(["full", "overview", "tasks", "attendance", "colleges", "leaderboard", "college", "group"]);
    if (fullTypes.has(type)) {
      const payload = await gatherFullAnalyticsPayload(sorted, filters);
      if (type === "college" || type === "group") {
        payload.filterLabel = [
          type === "college" ? `College: ${name}` : `Group: ${name}`,
          `${payload.summary.students} students`,
        ].join(" · ");
      }
      const { buffer, filename } = await buildFullAnalyticsExcel(payload);
      const outName =
        type === "college" || type === "group"
          ? `analytics-${type}-${name.replace(/\W+/g, "_").slice(0, 40)}.xlsx`
          : filename;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(buffer);
    }

    return res.status(400).json({ message: "Unknown export type" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Export failed" });
  }
});

/**
 * Print-ready full analytics report (JSON + chart images as base64).
 * Same data depth as full Excel export.
 */
router.get("/report", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  try {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const type = typeof req.query.type === "string" ? req.query.type : "full";

    const interns = await scopedInterns(req.user!.id, req.user!.role);
    let rows = await buildRows(interns);
    rows = applyRowFilters(rows, filters);
    if (type === "college" || type === "group") {
      if (!name) return res.status(400).json({ message: "name required" });
      rows = rows.filter((r) => (type === "college" ? r.college === name : r.groupName === name));
    }
    const sorted = sortRows(rows, filters.sort || "score_desc");
    const payload = await gatherFullAnalyticsPayload(sorted, filters);
    if (type === "college" || type === "group") {
      payload.filterLabel = `${type === "college" ? "College" : "Group"}: ${name} · ${payload.filterLabel}`;
    }
    return res.json(buildFullAnalyticsPrintPayload(payload));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Report failed" });
  }
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
