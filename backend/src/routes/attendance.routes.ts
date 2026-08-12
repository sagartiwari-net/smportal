import { Router } from "express";
import { z } from "zod";
import { AttendanceStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { getTrainerGroupIds, trainerCanAccessIntern, trainerOwnsGroup } from "../services/trainerScope";
import { computeInternPerformance } from "../services/performance";
import { buildInternExcelWorkbook } from "../services/internExcelExport";
import { buildDayAttendanceExcel, buildPeriodAttendanceExcel } from "../services/attendanceReportExcel";

const router = Router();
router.use(requireAuth);

function dayDate(input: string) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function parsePageLimit(query: Record<string, unknown>, fallbackLimit = 10) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  let limit = Number.parseInt(String(query.limit ?? fallbackLimit), 10) || fallbackLimit;
  if (![10, 20, 30].includes(limit)) limit = fallbackLimit;
  return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}

async function attendanceScope(role: string, userId: string, groupIdFilter: string) {
  if (role === "TRAINER") {
    const myGroupIds = await getTrainerGroupIds(userId);
    if (groupIdFilter && !myGroupIds.includes(groupIdFilter)) return { where: {}, empty: true as const };
    const scopeGroupIds = groupIdFilter ? [groupIdFilter] : myGroupIds;
    if (!scopeGroupIds.length) return { where: {}, empty: true as const };
    return {
      where: {
        intern: {
          approvalStatus: "APPROVED" as const,
          memberships: { some: { isActive: true, groupId: { in: scopeGroupIds } } },
        },
      },
      empty: false as const,
    };
  }
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId } });
    return {
      where: {
        intern: {
          approvalStatus: "APPROVED" as const,
          collegeId: profile?.collegeId || "",
          ...(groupIdFilter
            ? { memberships: { some: { isActive: true, groupId: groupIdFilter } } }
            : {}),
        },
      },
      empty: false as const,
    };
  }
  // ADMIN / HR
  return {
    where: groupIdFilter
      ? {
          intern: {
            approvalStatus: "APPROVED" as const,
            memberships: { some: { isActive: true, groupId: groupIdFilter } },
          },
        }
      : { intern: { approvalStatus: "APPROVED" as const } },
    empty: false as const,
  };
}

const recordInclude = {
  intern: {
    include: {
      user: { select: { fullName: true, email: true } },
      college: { select: { name: true } },
      memberships: {
        where: { isActive: true },
        take: 1,
        include: { group: { select: { id: true, name: true } } },
      },
    },
  },
  markedBy: { select: { id: true, fullName: true, role: true } },
};

function enrichRecords<T extends { intern?: { college?: { name: string } | null; memberships?: { group: { id: string; name: string } }[] } | null; markedBy?: { id: string; fullName: string; role: string } | null }>(
  rows: T[],
) {
  return rows.map((r) => {
    const group = r.intern?.memberships?.[0]?.group;
    return {
      ...r,
      groupId: group?.id || "unassigned",
      groupName: group?.name || "Unassigned / no group",
      collegeName: r.intern?.college?.name || null,
      markedByName: r.markedBy?.fullName || null,
      markedByRole: r.markedBy?.role || null,
    };
  });
}

/**
 * Staff history:
 * - view=groups → accordion headers
 * - groupId=… → paginated records for that group
 * Intern: own paginated records
 */
router.get("/", async (req, res) => {
  const role = req.user!.role;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const viewGroups = req.query.view === "groups";
  const { page, limit, skip } = parsePageLimit(req.query as Record<string, unknown>);

  const statusWhere =
    statusFilter && Object.values(AttendanceStatus).includes(statusFilter as AttendanceStatus)
      ? { status: statusFilter as AttendanceStatus }
      : {};

  if (role === "INTERN") {
    const profile = await prisma.internProfile.findUnique({ where: { userId: req.user!.id } });
    const where = {
      internId: profile?.id || "",
      ...statusWhere,
    };
    const [total, records] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
    ]);
    return res.json({
      records,
      pagination: paginationMeta(page, limit, total),
    });
  }

  const scope = await attendanceScope(role, req.user!.id, viewGroups ? groupIdFilter : groupIdFilter);
  if (scope.empty) {
    return res.json({
      groups: [],
      records: [],
      pagination: paginationMeta(page, limit, 0),
      statusCounts: { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 },
    });
  }

  const searchWhere = search
    ? {
        OR: [
          { intern: { user: { fullName: { contains: search } } } },
          { intern: { user: { email: { contains: search } } } },
          { intern: { college: { name: { contains: search } } } },
        ],
      }
    : {};

  const baseWhere = { ...scope.where, ...statusWhere, ...searchWhere };

  // Overall status counts (ignore status filter for chips)
  const countWhere = { ...scope.where, ...searchWhere };
  const groupedCounts = await prisma.attendance.groupBy({
    by: ["status"],
    where: countWhere,
    _count: { _all: true },
  });
  const statusCounts = { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 };
  for (const row of groupedCounts) {
    if (row.status in statusCounts) statusCounts[row.status as keyof typeof statusCounts] = row._count._all;
  }

  if (viewGroups) {
    // Lightweight pull for group aggregation (ids + status + membership)
    const rows = await prisma.attendance.findMany({
      where: baseWhere,
      select: {
        status: true,
        intern: {
          select: {
            memberships: {
              where: { isActive: true },
              take: 1,
              select: { group: { select: { id: true, name: true } } },
            },
            college: { select: { name: true } },
          },
        },
      },
    });

    const map = new Map<
      string,
      {
        groupId: string;
        groupName: string;
        collegeName: string | null;
        recordCount: number;
        counts: { PRESENT: number; ABSENT: number; LEAVE: number; WEEK_OFF: number };
      }
    >();

    for (const r of rows) {
      const g = r.intern?.memberships?.[0]?.group;
      const gid = g?.id || "unassigned";
      const gname = g?.name || "Unassigned / no group";
      let entry = map.get(gid);
      if (!entry) {
        entry = {
          groupId: gid,
          groupName: gname,
          collegeName: r.intern?.college?.name || null,
          recordCount: 0,
          counts: { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 },
        };
        map.set(gid, entry);
      }
      entry.recordCount += 1;
      if (r.status in entry.counts) entry.counts[r.status as keyof typeof entry.counts] += 1;
    }

    const groups = [...map.values()].sort((a, b) => a.groupName.localeCompare(b.groupName));
    return res.json({ groups, records: [], statusCounts });
  }

  if (!groupIdFilter) {
    return res.status(400).json({ message: "groupId required to list attendance (open a group)" });
  }

  // Exact group scope for list
  const listScope = await attendanceScope(role, req.user!.id, groupIdFilter === "unassigned" ? "" : groupIdFilter);
  if (listScope.empty && groupIdFilter !== "unassigned") {
    return res.json({ records: [], pagination: paginationMeta(page, limit, 0), statusCounts });
  }

  const listWhere =
    groupIdFilter === "unassigned"
      ? {
          ...statusWhere,
          ...searchWhere,
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
              : role === "TRAINER"
                ? {
                    memberships: { none: { isActive: true } },
                    // trainers typically won't see unassigned; keep empty-safe
                  }
                : {}),
          },
        }
      : { ...listScope.where, ...statusWhere, ...searchWhere };

  const [total, records] = await Promise.all([
    prisma.attendance.count({ where: listWhere }),
    prisma.attendance.findMany({
      where: listWhere,
      include: recordInclude,
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  res.json({
    records: enrichRecords(records),
    pagination: paginationMeta(page, limit, total),
    statusCounts,
  });
});

router.post("/mark", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    date: z.string(),
    groupId: z.string().optional(),
    entries: z
      .array(
        z.object({
          internId: z.string(),
          status: z.enum(["PRESENT", "ABSENT", "LEAVE", "WEEK_OFF"]),
          note: z.string().optional(),
        }),
      )
      .min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const date = dayDate(parsed.data.date);
  const today = dayDate(new Date().toISOString().slice(0, 10));
  if (date.getTime() > today.getTime()) {
    return res.status(400).json({ message: "Future date pe attendance mark nahi kar sakte" });
  }

  if (req.user!.role === "TRAINER") {
    if (parsed.data.groupId) {
      const ok = await trainerOwnsGroup(req.user!.id, parsed.data.groupId);
      if (!ok) return res.status(403).json({ message: "Not your group" });
    }
    for (const e of parsed.data.entries) {
      const ok = await trainerCanAccessIntern(req.user!.id, e.internId);
      if (!ok) return res.status(403).json({ message: "Cannot mark outside your groups" });
    }
  }

  // Lock attendance after internship completed (group or intern)
  if (parsed.data.groupId) {
    const g = await prisma.trainingGroup.findUnique({
      where: { id: parsed.data.groupId },
      select: { internshipStatus: true, name: true },
    });
    if (g?.internshipStatus === "COMPLETED") {
      return res.status(403).json({
        message: `Group "${g.name}" internship complete hai — attendance change nahi ho sakti`,
      });
    }
  }
  const internIds = parsed.data.entries.map((e) => e.internId);
  const lockedInterns = await prisma.internProfile.findMany({
    where: { id: { in: internIds }, internshipStatus: "COMPLETED" },
    select: { id: true, user: { select: { fullName: true } } },
  });
  if (lockedInterns.length) {
    return res.status(403).json({
      message: `Internship complete: ${lockedInterns.map((i) => i.user.fullName).join(", ")} — attendance lock`,
    });
  }

  await prisma.$transaction(
    parsed.data.entries.map((e) =>
      prisma.attendance.upsert({
        where: { internId_date: { internId: e.internId, date } },
        update: {
          status: e.status as AttendanceStatus,
          note: e.note || null,
          markedById: req.user!.id,
        },
        create: {
          internId: e.internId,
          date,
          status: e.status as AttendanceStatus,
          note: e.note || null,
          markedById: req.user!.id,
        },
      }),
    ),
  );

  res.json({ message: "Attendance saved", count: parsed.data.entries.length });
});

router.get("/summary/:internId", async (req, res) => {
  const records = await prisma.attendance.findMany({ where: { internId: req.params.internId } });
  const present = records.filter((r) => r.status === "PRESENT").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const leave = records.filter((r) => r.status === "LEAVE").length;
  const weekOff = records.filter((r) => r.status === "WEEK_OFF").length;
  const counted = present + absent + leave;
  const attendanceRate = counted === 0 ? 0 : Math.round((present / counted) * 100);
  res.json({ present, absent, leave, weekOff, attendanceRate, total: records.length });
});

function resolveDateRange(period: string, fromStr?: string, toStr?: string) {
  const today = dayDate(new Date().toISOString().slice(0, 10));
  if (period === "custom" && fromStr && toStr) {
    return { from: dayDate(fromStr), to: dayDate(toStr) };
  }
  if (period === "all") {
    return { from: new Date(Date.UTC(2000, 0, 1)), to: today };
  }
  // Exact calendar month: "2026-07"
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    const to = monthEnd.getTime() > today.getTime() ? today : monthEnd;
    return { from, to };
  }
  if (period === "month") {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from, to: today };
  }
  if (period === "last_month") {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { from, to };
  }
  // default: current week (Mon → today)
  const dow = today.getUTCDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const from = new Date(today);
  from.setUTCDate(today.getUTCDate() + mondayOffset);
  return { from, to: today };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Build period dropdown from intern's real attendance / join window */
async function buildInternPeriodOptions(internId: string, joinedAt: Date, completedAt: Date | null) {
  const today = dayDate(new Date().toISOString().slice(0, 10));
  const agg = await prisma.attendance.aggregate({
    where: { internId },
    _min: { date: true },
    _max: { date: true },
  });

  const start = agg._min.date || joinedAt || today;
  const end = completedAt && completedAt < today ? dayDate(completedAt.toISOString().slice(0, 10)) : agg._max.date || today;

  const options: { value: string; label: string }[] = [];
  const startUtc = dayDate(start.toISOString().slice(0, 10));
  const endUtc = dayDate(end.toISOString().slice(0, 10));

  // Rolling shortcuts only if they overlap intern window
  const week = resolveDateRange("week");
  if (week.to >= startUtc && week.from <= endUtc) {
    options.push({ value: "week", label: "This week" });
  }
  const month = resolveDateRange("month");
  if (month.to >= startUtc && month.from <= endUtc) {
    options.push({ value: "month", label: "This month" });
  }
  const lastMonth = resolveDateRange("last_month");
  if (lastMonth.to >= startUtc && lastMonth.from <= endUtc) {
    options.push({ value: "last_month", label: "Last month" });
  }

  // Exact months the intern was in (newest first)
  const cursor = new Date(Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth(), 1));
  const startMonth = new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth(), 1));
  let guard = 0;
  while (cursor >= startMonth && guard < 60) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`;
    if (!options.some((o) => o.value === key)) {
      options.push({ value: key, label });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    guard += 1;
  }

  options.push({ value: "all", label: "All time" });
  options.push({ value: "custom", label: "Custom range" });
  return options;
}

/** Daily attendance summary cards — only dates that have marks */
router.get("/report/days", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const period = typeof req.query.period === "string" ? req.query.period : "week";
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";

  const { from, to } = resolveDateRange(period, fromStr || undefined, toStr || undefined);
  const scope = await attendanceScope(role, req.user!.id, groupIdFilter);
  if (scope.empty) return res.json({ days: [], from, to, period });

  const rows = await prisma.attendance.findMany({
    where: {
      ...scope.where,
      date: { gte: from, lte: to },
    },
    select: {
      date: true,
      status: true,
      markedBy: { select: { id: true, fullName: true, role: true } },
    },
    orderBy: { date: "desc" },
  });

  type DayAgg = {
    date: string;
    present: number;
    absent: number;
    leave: number;
    weekOff: number;
    total: number;
    isWeekOffDay: boolean;
    markedBy: { id: string; fullName: string; role: string }[];
  };

  const map = new Map<string, DayAgg>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    let d = map.get(key);
    if (!d) {
      d = {
        date: key,
        present: 0,
        absent: 0,
        leave: 0,
        weekOff: 0,
        total: 0,
        isWeekOffDay: false,
        markedBy: [],
      };
      map.set(key, d);
    }
    d.total += 1;
    if (r.status === "PRESENT") d.present += 1;
    else if (r.status === "ABSENT") d.absent += 1;
    else if (r.status === "LEAVE") d.leave += 1;
    else if (r.status === "WEEK_OFF") d.weekOff += 1;
    if (r.markedBy && !d.markedBy.some((m) => m.id === r.markedBy!.id)) {
      d.markedBy.push(r.markedBy);
    }
  }

  const days = [...map.values()]
    .map((d) => ({
      ...d,
      isWeekOffDay: d.total > 0 && d.weekOff === d.total,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  res.json({ days, from, to, period });
});

/** One date — student-wise rows (optional group filter) */
router.get("/report/day", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  if (!dateStr) return res.status(400).json({ message: "date required" });

  const date = dayDate(dateStr);
  const scope = await attendanceScope(role, req.user!.id, groupIdFilter);
  if (scope.empty) return res.json({ date: dateStr, records: [] });

  const records = await prisma.attendance.findMany({
    where: { ...scope.where, date },
    include: recordInclude,
    orderBy: { updatedAt: "desc" },
  });

  const enriched = enrichRecords(records);
  const counts = {
    PRESENT: enriched.filter((r) => r.status === "PRESENT").length,
    ABSENT: enriched.filter((r) => r.status === "ABSENT").length,
    LEAVE: enriched.filter((r) => r.status === "LEAVE").length,
    WEEK_OFF: enriched.filter((r) => r.status === "WEEK_OFF").length,
  };

  res.json({
    date: dateStr,
    records: enriched,
    counts,
    isWeekOffDay: enriched.length > 0 && counts.WEEK_OFF === enriched.length,
  });
});

/** Excel — one day's student roster */
router.get("/report/day/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";
  if (!dateStr) return res.status(400).json({ message: "date required" });

  const date = dayDate(dateStr);
  const scope = await attendanceScope(role, req.user!.id, groupIdFilter);

  let groupLabel = "All groups";
  if (groupIdFilter) {
    const g = await prisma.group.findUnique({ where: { id: groupIdFilter }, select: { name: true } });
    groupLabel = g?.name || groupIdFilter;
  }

  if (scope.empty) {
    const { buffer, filename } = await buildDayAttendanceExcel({
      date: dateStr,
      groupLabel,
      counts: { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 },
      rows: [],
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  const records = await prisma.attendance.findMany({
    where: { ...scope.where, date },
    include: recordInclude,
    orderBy: { updatedAt: "desc" },
  });
  const enriched = enrichRecords(records);
  const counts = {
    PRESENT: enriched.filter((r) => r.status === "PRESENT").length,
    ABSENT: enriched.filter((r) => r.status === "ABSENT").length,
    LEAVE: enriched.filter((r) => r.status === "LEAVE").length,
    WEEK_OFF: enriched.filter((r) => r.status === "WEEK_OFF").length,
  };

  try {
    const { buffer, filename } = await buildDayAttendanceExcel({
      date: dateStr,
      groupLabel,
      counts,
      rows: enriched.map((r) => ({
        student: r.intern?.user?.fullName || "—",
        email: r.intern?.user?.email || null,
        group: r.groupName || "—",
        college: r.collegeName || "—",
        status: String(r.status),
        markedBy: r.markedByName
          ? `${r.markedByName}${r.markedByRole ? ` (${r.markedByRole})` : ""}`
          : "—",
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

/** Excel — full period (day cards + every student row) */
router.get("/report/period/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const period = typeof req.query.period === "string" ? req.query.period : "week";
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  const groupIdFilter = typeof req.query.groupId === "string" ? req.query.groupId : "";

  const { from, to } = resolveDateRange(period, fromStr || undefined, toStr || undefined);
  const scope = await attendanceScope(role, req.user!.id, groupIdFilter);

  let groupLabel = "All groups";
  if (groupIdFilter) {
    const g = await prisma.group.findUnique({ where: { id: groupIdFilter }, select: { name: true } });
    groupLabel = g?.name || groupIdFilter;
  }

  const periodLabel =
    period === "custom"
      ? `Custom ${fromStr} → ${toStr}`
      : period === "week"
        ? "This week"
        : period === "month"
          ? "This month"
          : period === "last_month"
            ? "Last month"
            : period;

  const emptyPack = async () => {
    const { buffer, filename } = await buildPeriodAttendanceExcel({
      periodLabel,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      groupLabel,
      daySummaries: [],
      details: [],
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  };

  if (scope.empty) return emptyPack();

  const records = await prisma.attendance.findMany({
    where: {
      ...scope.where,
      date: { gte: from, lte: to },
    },
    include: recordInclude,
    orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
  });
  const enriched = enrichRecords(records);

  type DayAgg = {
    date: string;
    present: number;
    absent: number;
    leave: number;
    weekOff: number;
    total: number;
  };
  const map = new Map<string, DayAgg>();
  for (const r of enriched) {
    const key = r.date.toISOString().slice(0, 10);
    let d = map.get(key);
    if (!d) {
      d = { date: key, present: 0, absent: 0, leave: 0, weekOff: 0, total: 0 };
      map.set(key, d);
    }
    d.total += 1;
    if (r.status === "PRESENT") d.present += 1;
    else if (r.status === "ABSENT") d.absent += 1;
    else if (r.status === "LEAVE") d.leave += 1;
    else if (r.status === "WEEK_OFF") d.weekOff += 1;
  }

  try {
    const { buffer, filename } = await buildPeriodAttendanceExcel({
      periodLabel,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      groupLabel,
      daySummaries: [...map.values()].sort((a, b) => b.date.localeCompare(a.date)),
      details: enriched.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        student: r.intern?.user?.fullName || "—",
        email: r.intern?.user?.email || null,
        group: r.groupName || "—",
        college: r.collegeName || "—",
        status: String(r.status),
        markedBy: r.markedByName
          ? `${r.markedByName}${r.markedByRole ? ` (${r.markedByRole})` : ""}`
          : "—",
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

/** Full intern dossier for attendance drill-down */
router.get("/report/intern/:internId", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const internId = req.params.internId;

  if (role === "TRAINER") {
    const ok = await trainerCanAccessIntern(req.user!.id, internId);
    if (!ok) return res.status(403).json({ message: "Not your intern" });
  }
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const intern = await prisma.internProfile.findUnique({ where: { id: internId }, select: { collegeId: true } });
    if (!intern || intern.collegeId !== profile?.collegeId) {
      return res.status(403).json({ message: "Not your college intern" });
    }
  }

  const period = typeof req.query.period === "string" ? req.query.period : "";
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  const attPage = Math.max(1, Number.parseInt(String(req.query.attPage ?? "1"), 10) || 1);
  let attLimit = Number.parseInt(String(req.query.attLimit ?? "10"), 10) || 10;
  if (![10, 20, 30].includes(attLimit)) attLimit = 10;
  const taskPage = Math.max(1, Number.parseInt(String(req.query.taskPage ?? "1"), 10) || 1);
  let taskLimit = Number.parseInt(String(req.query.taskLimit ?? "10"), 10) || 10;
  if (![10, 20, 30].includes(taskLimit)) taskLimit = 10;
  const taskStatus =
    typeof req.query.taskStatus === "string" && req.query.taskStatus !== "all" ? req.query.taskStatus : "";

  const intern = await prisma.internProfile.findUnique({
    where: { id: internId },
    include: {
      user: { select: { fullName: true, email: true } },
      college: { select: { id: true, name: true } },
      completedBy: { select: { fullName: true, role: true } },
      hiredBy: { select: { fullName: true, role: true } },
      memberships: {
        include: {
          group: {
            select: {
              id: true,
              name: true,
              internshipStatus: true,
              batchLabel: true,
            },
          },
        },
        orderBy: { joinedAt: "desc" },
      },
    },
  });
  if (!intern) return res.status(404).json({ message: "Intern not found" });

  const periodOptions = await buildInternPeriodOptions(internId, intern.joinedAt, intern.completedAt);
  const effectivePeriod =
    period && (period === "custom" || periodOptions.some((o) => o.value === period))
      ? period
      : periodOptions.find((o) => o.value === "month")?.value ||
        periodOptions.find((o) => /^\d{4}-\d{2}$/.test(o.value))?.value ||
        periodOptions[0]?.value ||
        "all";

  const { from, to } = resolveDateRange(effectivePeriod, fromStr || undefined, toStr || undefined);

  // Current groups = active memberships only (dedupe by groupId)
  const activeMap = new Map<string, (typeof intern.memberships)[0]>();
  for (const m of intern.memberships) {
    if (!m.isActive) continue;
    if (!activeMap.has(m.group.id)) activeMap.set(m.group.id, m);
  }
  // Past = inactive memberships, one row per group (latest left)
  const pastMap = new Map<string, (typeof intern.memberships)[0]>();
  for (const m of intern.memberships) {
    if (m.isActive) continue;
    if (activeMap.has(m.group.id)) continue;
    const prev = pastMap.get(m.group.id);
    if (!prev || (m.leftAt && prev.leftAt && m.leftAt > prev.leftAt) || (!prev.leftAt && m.leftAt)) {
      pastMap.set(m.group.id, m);
    } else if (!prev) pastMap.set(m.group.id, m);
  }

  const attWhere = { internId, date: { gte: from, lte: to } };
  const taskWhere = {
    internId,
    ...(taskStatus ? { status: taskStatus as "ASSIGNED" | "SUBMITTED" | "NEEDS_IMPROVEMENT" | "DONE" } : {}),
  };

  const [perf, attTotal, attendanceRows, taskTotal, assignments] = await Promise.all([
    computeInternPerformance(internId),
    prisma.attendance.count({ where: attWhere }),
    prisma.attendance.findMany({
      where: attWhere,
      include: { markedBy: { select: { fullName: true, role: true } } },
      orderBy: { date: "desc" },
      skip: (attPage - 1) * attLimit,
      take: attLimit,
    }),
    prisma.taskAssignment.count({ where: taskWhere }),
    prisma.taskAssignment.findMany({
      where: taskWhere,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            groupId: true,
            group: { select: { id: true, name: true } },
            sourceLibraryId: true,
          },
        },
      },
      orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
      skip: (taskPage - 1) * taskLimit,
      take: taskLimit,
    }),
  ]);

  res.json({
    intern: {
      id: intern.id,
      fullName: intern.user.fullName,
      email: intern.user.email,
      phone: intern.phone,
      college: intern.college,
      joinedAt: intern.joinedAt,
      internshipStatus: intern.internshipStatus,
      completedAt: intern.completedAt,
      completedBy: intern.completedBy,
      isHired: intern.isHired,
      hiredAt: intern.hiredAt,
      hiredBy: intern.hiredBy,
      hireNote: intern.hireNote,
      groups: [...activeMap.values()].map((m) => ({
        id: m.group.id,
        name: m.group.name,
        batchLabel: m.group.batchLabel,
        internshipStatus: m.group.internshipStatus,
        isActiveMember: true,
        joinedAt: m.joinedAt,
        leftAt: null,
      })),
      pastGroups: [...pastMap.values()].map((m) => ({
        id: m.group.id,
        name: m.group.name,
        batchLabel: m.group.batchLabel,
        internshipStatus: m.group.internshipStatus,
        leftAt: m.leftAt,
        joinedAt: m.joinedAt,
      })),
    },
    periodOptions,
    selectedPeriod: effectivePeriod,
    performance: perf,
    attendance: {
      from,
      to,
      period: effectivePeriod,
      records: attendanceRows,
      pagination: paginationMeta(attPage, attLimit, attTotal),
    },
    tasks: {
      records: assignments.map((a) => ({
        id: a.id,
        status: a.status,
        forDate: a.forDate,
        dayNumber: a.dayNumber,
        taskNumber: a.taskNumber,
        title: a.task.title,
        description: a.task.description,
        groupId: a.task.groupId,
        groupName: a.task.group?.name || null,
      })),
      pagination: paginationMeta(taskPage, taskLimit, taskTotal),
      statusFilter: taskStatus || "all",
    },
  });
});

/** Excel export — multi-sheet workbook with Dashboard + filters tip */
router.get("/report/intern/:internId/export", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;
  const internId = req.params.internId;

  if (role === "TRAINER") {
    const ok = await trainerCanAccessIntern(req.user!.id, internId);
    if (!ok) return res.status(403).json({ message: "Not your intern" });
  }
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const intern = await prisma.internProfile.findUnique({ where: { id: internId }, select: { collegeId: true } });
    if (!intern || intern.collegeId !== profile?.collegeId) {
      return res.status(403).json({ message: "Not your college intern" });
    }
  }

  try {
    const { buffer, filename } = await buildInternExcelWorkbook(internId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Export failed" });
  }
});

export default router;
