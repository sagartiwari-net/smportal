import ExcelJS from "exceljs";
import { prisma } from "../config/db";
import { computeInternPerformance } from "./performance";
import {
  attendanceStatusDoughnut,
  monthlyAttendanceBarChart,
  taskCompletionBar,
  taskStatusDoughnut,
} from "./excelChartImages";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const C = {
  header: "FF0F766E",
  headerText: "FFFFFFFF",
  cardBg: "FFF0FDFA",
  cardBorder: "FF5EEAD4",
  muted: "FF64748B",
  title: "FF0F172A",
  teal: "FF0F766E",
  soft: "FFF1F5F9",
  panel: "FFF8FAFC",
  tableHead: "FF134E4A",
};

function fillSolid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function paintRange(sheet: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, argb: string) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      sheet.getCell(r, c).fill = fillSolid(argb);
    }
  }
}

function styleKpiCard(
  sheet: ExcelJS.Worksheet,
  startCol: number,
  startRow: number,
  label: string,
  value: string | number,
  sub?: string,
) {
  const endCol = startCol + 1;
  sheet.mergeCells(startRow, startCol, startRow, endCol);
  sheet.mergeCells(startRow + 1, startCol, startRow + 1, endCol);
  sheet.mergeCells(startRow + 2, startCol, startRow + 2, endCol);

  for (let r = startRow; r <= startRow + 2; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(r, c);
      cell.fill = fillSolid(C.cardBg);
      cell.border = {
        top: { style: "medium", color: { argb: C.cardBorder } },
        left: { style: "medium", color: { argb: C.cardBorder } },
        bottom: { style: "medium", color: { argb: C.cardBorder } },
        right: { style: "medium", color: { argb: C.cardBorder } },
      };
    }
  }

  sheet.getCell(startRow, startCol).value = label;
  sheet.getCell(startRow, startCol).font = { size: 11, color: { argb: C.muted }, bold: true };
  sheet.getCell(startRow, startCol).alignment = { horizontal: "center", vertical: "middle" };

  sheet.getCell(startRow + 1, startCol).value = value;
  sheet.getCell(startRow + 1, startCol).font = { size: 26, bold: true, color: { argb: C.teal } };
  sheet.getCell(startRow + 1, startCol).alignment = { horizontal: "center", vertical: "middle" };

  sheet.getCell(startRow + 2, startCol).value = sub || "";
  sheet.getCell(startRow + 2, startCol).font = { size: 11, color: { argb: C.muted } };
  sheet.getCell(startRow + 2, startCol).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  sheet.getRow(startRow).height = 22;
  sheet.getRow(startRow + 1).height = 38;
  sheet.getRow(startRow + 2).height = 22;
}

function sectionTitle(sheet: ExcelJS.Worksheet, row: number, cols: number, text: string) {
  sheet.mergeCells(row, 1, row, cols);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { size: 15, bold: true, color: { argb: C.headerText } };
  cell.fill = fillSolid(C.header);
  cell.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(row).height = 28;
}

/**
 * Full intern Excel report — always loads ALL attendance + ALL tasks from DB
 * (not the paginated / period-filtered screen view).
 */
export async function buildInternExcelWorkbook(internId: string) {
  const intern = await prisma.internProfile.findUnique({
    where: { id: internId },
    include: {
      user: { select: { fullName: true, email: true } },
      college: { select: { name: true } },
      completedBy: { select: { fullName: true, role: true } },
      hiredBy: { select: { fullName: true, role: true } },
      memberships: {
        where: { isActive: true },
        include: { group: { select: { name: true, batchLabel: true, internshipStatus: true } } },
      },
    },
  });
  if (!intern) throw new Error("Intern not found");

  // Full history from database — no period / page limits
  const [perf, attendance, assignments] = await Promise.all([
    computeInternPerformance(internId),
    prisma.attendance.findMany({
      where: { internId },
      include: { markedBy: { select: { fullName: true, role: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.taskAssignment.findMany({
      where: { internId },
      include: { task: { select: { title: true, description: true } } },
      orderBy: [{ forDate: "asc" }, { taskNumber: "asc" }],
    }),
  ]);

  const dataFrom = attendance[0]?.date || intern.joinedAt;
  const dataTo = attendance[attendance.length - 1]?.date || new Date();

  const monthMap = new Map<
    string,
    { present: number; absent: number; leave: number; weekOff: number; total: number }
  >();
  for (const a of attendance) {
    const key = monthKey(a.date);
    let row = monthMap.get(key);
    if (!row) {
      row = { present: 0, absent: 0, leave: 0, weekOff: 0, total: 0 };
      monthMap.set(key, row);
    }
    row.total += 1;
    if (a.status === "PRESENT") row.present += 1;
    else if (a.status === "ABSENT") row.absent += 1;
    else if (a.status === "LEAVE") row.leave += 1;
    else if (a.status === "WEEK_OFF") row.weekOff += 1;
  }
  const months = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, m]) => {
      const [y, mo] = key.split("-").map(Number);
      return {
        label: `${MONTH[mo - 1]} ${y}`,
        present: m.present,
        absent: m.absent,
        leave: m.leave,
        weekOff: m.weekOff,
        total: m.total,
      };
    });

  const taskStatus = {
    ASSIGNED: assignments.filter((a) => a.status === "ASSIGNED").length,
    SUBMITTED: assignments.filter((a) => a.status === "SUBMITTED").length,
    NEEDS_IMPROVEMENT: assignments.filter((a) => a.status === "NEEDS_IMPROVEMENT").length,
    DONE: assignments.filter((a) => a.status === "DONE").length,
  };

  const attMix = {
    present: attendance.filter((a) => a.status === "PRESENT").length,
    absent: attendance.filter((a) => a.status === "ABSENT").length,
    leave: attendance.filter((a) => a.status === "LEAVE").length,
    weekOff: attendance.filter((a) => a.status === "WEEK_OFF").length,
  };

  const chartMonths =
    months.length > 0
      ? months
      : [{ label: "No data", present: 0, absent: 0, leave: 0, weekOff: 0, total: 0 }];

  const barPng = monthlyAttendanceBarChart(chartMonths);
  const taskPiePng = taskStatusDoughnut({
    assigned: taskStatus.ASSIGNED,
    submitted: taskStatus.SUBMITTED,
    needsImprovement: taskStatus.NEEDS_IMPROVEMENT,
    done: taskStatus.DONE,
  });
  const attPiePng = attendanceStatusDoughnut(attMix);
  const taskBarPng = taskCompletionBar(perf.doneTasks, perf.totalTasks || 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";
  wb.created = new Date();

  // ——— Dashboard ———
  // Layout (no overlap): header 1-3 | metrics 5-8 | charts top 10-27 | charts bottom 29-45 | tables 47+
  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: "FF0F766E" } },
  });
  for (let c = 1; c <= 14; c++) dash.getColumn(c).width = 13;

  dash.mergeCells("A1:N1");
  dash.getCell("A1").value = "INTERN PERFORMANCE DASHBOARD";
  dash.getCell("A1").font = { size: 24, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getCell("A1").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  dash.getRow(1).height = 44;

  dash.mergeCells("A2:N2");
  dash.getCell("A2").value =
    `${intern.user.fullName}  ·  ${intern.user.email}  ·  ${intern.college?.name || "—"}  ·  Groups: ${
      intern.memberships.map((m) => m.group.name).join(", ") || "—"
    }`;
  dash.getCell("A2").font = { size: 14, color: { argb: C.headerText }, bold: true };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getCell("A2").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(2).height = 28;

  dash.mergeCells("A3:N3");
  dash.getCell("A3").value =
    `Full database report (all time)  ·  Attendance: ${attendance.length}  ·  Tasks: ${assignments.length}  ·  ${ymd(dataFrom)} → ${ymd(dataTo)}  ·  Generated ${ymd(new Date())}  ·  ${intern.internshipStatus}${
      intern.isHired ? " · Hired" : ""
    }`;
  dash.getCell("A3").font = { size: 12, color: { argb: "FFCCFBF1" } };
  dash.getCell("A3").fill = fillSolid("FF134E4A");
  dash.getCell("A3").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(3).height = 26;

  sectionTitle(dash, 5, 14, "KEY METRICS");
  styleKpiCard(dash, 1, 6, "OVERALL SCORE", perf.score, "attendance + tasks");
  styleKpiCard(dash, 3, 6, "ATTENDANCE %", `${perf.attendanceRate}%`, `P ${attMix.present} · A ${attMix.absent} · L ${attMix.leave}`);
  styleKpiCard(dash, 5, 6, "TASK COMPLETION", `${perf.taskCompletionRate}%`, `${perf.doneTasks} of ${perf.totalTasks}`);
  styleKpiCard(dash, 7, 6, "PRESENT DAYS", attMix.present, `of ${attendance.length} marks`);
  styleKpiCard(dash, 9, 6, "ABSENT / LEAVE", `${attMix.absent} / ${attMix.leave}`, `Week off ${attMix.weekOff}`);
  styleKpiCard(dash, 11, 6, "TASKS DONE", `${perf.doneTasks}/${perf.totalTasks || 0}`, `Assigned ${taskStatus.ASSIGNED}`);

  sectionTitle(dash, 10, 14, "CHARTS");
  paintRange(dash, 11, 1, 45, 14, C.panel);
  for (let r = 11; r <= 27; r++) dash.getRow(r).height = 18;
  for (let r = 29; r <= 45; r++) dash.getRow(r).height = 18;
  dash.getRow(28).height = 12;

  const barId = wb.addImage({ buffer: barPng, extension: "png" });
  const taskPieId = wb.addImage({ buffer: taskPiePng, extension: "png" });
  const attPieId = wb.addImage({ buffer: attPiePng, extension: "png" });
  const taskBarId = wb.addImage({ buffer: taskBarPng, extension: "png" });

  dash.addImage(barId, { tl: { col: 0.2, row: 11.2 }, ext: { width: 560, height: 300 } });
  dash.addImage(taskPieId, { tl: { col: 7.3, row: 11.2 }, ext: { width: 380, height: 300 } });
  dash.addImage(attPieId, { tl: { col: 0.2, row: 29.2 }, ext: { width: 380, height: 300 } });
  dash.addImage(taskBarId, { tl: { col: 5.5, row: 29.2 }, ext: { width: 520, height: 260 } });

  const summaryTitleRow = 47;
  sectionTitle(dash, summaryTitleRow, 14, "SUMMARY TABLES");

  const labelRow = summaryTitleRow + 2;
  dash.getCell(labelRow, 1).value = "Monthly attendance";
  dash.getCell(labelRow, 1).font = { bold: true, size: 14, color: { argb: C.title } };
  dash.getCell(labelRow, 9).value = "Task status";
  dash.getCell(labelRow, 9).font = { bold: true, size: 14, color: { argb: C.title } };

  const monthRows = (
    months.length
      ? months
      : [{ label: "No data", present: 0, absent: 0, leave: 0, weekOff: 0, total: 0 }]
  ).map((m) => {
    const counted = m.present + m.absent + m.leave;
    const pct = counted === 0 ? 0 : m.present / counted;
    return [m.label, m.present, m.absent, m.leave, m.weekOff, m.total, pct] as (string | number)[];
  });

  const tableStart = labelRow + 1;
  dash.addTable({
    name: "MonthlyAttendance",
    ref: `A${tableStart}`,
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Month", filterButton: true },
      { name: "Present", filterButton: true },
      { name: "Absent", filterButton: true },
      { name: "Leave", filterButton: true },
      { name: "Week off", filterButton: true },
      { name: "Total", filterButton: true },
      { name: "Present %", filterButton: true },
    ],
    rows: monthRows,
  });
  dash.getRow(tableStart).height = 22;
  for (let i = 0; i < monthRows.length; i++) {
    const r = tableStart + 1 + i;
    dash.getCell(r, 7).numFmt = "0%";
    dash.getRow(r).height = 20;
  }

  const taskTotal = assignments.length || 1;
  const taskRowsData: (string | number)[][] = [
    ["Assigned", taskStatus.ASSIGNED, taskStatus.ASSIGNED / taskTotal],
    ["Submitted", taskStatus.SUBMITTED, taskStatus.SUBMITTED / taskTotal],
    ["Needs improvement", taskStatus.NEEDS_IMPROVEMENT, taskStatus.NEEDS_IMPROVEMENT / taskTotal],
    ["Done", taskStatus.DONE, taskStatus.DONE / taskTotal],
  ];
  dash.addTable({
    name: "TaskStatusSummary",
    ref: `I${tableStart}`,
    headerRow: true,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [
      { name: "Status", filterButton: true },
      { name: "Count", filterButton: true },
      { name: "Share", filterButton: true },
    ],
    rows: taskRowsData,
  });
  for (let i = 0; i < 4; i++) dash.getCell(tableStart + 1 + i, 11).numFmt = "0%";

  const tipRow = tableStart + Math.max(monthRows.length, 4) + 3;
  dash.mergeCells(tipRow, 1, tipRow, 14);
  dash.getCell(tipRow, 1).value =
    "Detail sheets → Attendance (every mark) · Tasks (every assignment) · Profile.  Use column dropdown filters on those sheets.";
  dash.getCell(tipRow, 1).font = { italic: true, size: 12, color: { argb: C.muted } };
  dash.getRow(tipRow).height = 22;

  // ——— Profile ———
  const profile = wb.addWorksheet("Profile", { properties: { tabColor: { argb: "FF6366F1" } } });
  profile.getColumn(1).width = 28;
  profile.getColumn(2).width = 56;
  profile.views = [{ state: "normal", zoomScale: 110 }];
  profile.addTable({
    name: "ProfileTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Field", filterButton: true },
      { name: "Value", filterButton: true },
    ],
    rows: [
      ["Full name", intern.user.fullName],
      ["Email", intern.user.email],
      ["College", intern.college?.name || "—"],
      ["Phone", intern.phone || "—"],
      ["Joined", ymd(intern.joinedAt)],
      ["Internship status", intern.internshipStatus],
      ["Completed at", intern.completedAt ? ymd(intern.completedAt) : "—"],
      ["Completed by", intern.completedBy ? `${intern.completedBy.fullName} (${intern.completedBy.role})` : "—"],
      ["Hired", intern.isHired ? "Yes" : "No"],
      ["Hired at", intern.hiredAt ? ymd(intern.hiredAt) : "—"],
      ["Hired by", intern.hiredBy ? `${intern.hiredBy.fullName} (${intern.hiredBy.role})` : "—"],
      ["Hire note", intern.hireNote || "—"],
      ["Active groups", intern.memberships.map((m) => m.group.name).join(", ") || "—"],
      ["Attendance records (all)", attendance.length],
      ["Task assignments (all)", assignments.length],
      ["Overall score", perf.score],
      ["Attendance %", perf.attendanceRate],
      ["Task completion %", perf.taskCompletionRate],
    ],
  });
  for (let r = 1; r <= 19; r++) {
    profile.getRow(r).font = { size: 12 };
    profile.getRow(r).height = 20;
  }
  profile.getRow(1).font = { size: 13, bold: true };

  // ——— Attendance (full DB) ———
  const att = wb.addWorksheet("Attendance", { properties: { tabColor: { argb: "FF0D9488" } } });
  att.views = [{ state: "normal", zoomScale: 110 }];
  att.columns = [{ width: 16 }, { width: 16 }, { width: 28 }, { width: 14 }];
  att.addTable({
    name: "AttendanceTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Marked by", filterButton: true },
      { name: "Role", filterButton: true },
    ],
    rows:
      attendance.length > 0
        ? attendance.map((a) => [ymd(a.date), a.status, a.markedBy?.fullName || "—", a.markedBy?.role || "—"])
        : [["—", "NO_DATA", "—", "—"]],
  });
  const attRowsN = Math.max(1, attendance.length) + 1;
  for (let r = 1; r <= attRowsN; r++) {
    att.getRow(r).font = { size: 12 };
    att.getRow(r).height = 20;
  }
  att.getRow(1).font = { size: 13, bold: true };

  // ——— Tasks (full DB) ———
  const tasks = wb.addWorksheet("Tasks", { properties: { tabColor: { argb: "FF16A34A" } } });
  tasks.views = [{ state: "normal", zoomScale: 110 }];
  tasks.columns = [{ width: 10 }, { width: 10 }, { width: 36 }, { width: 14 }, { width: 20 }, { width: 48 }];
  tasks.addTable({
    name: "TasksTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [
      { name: "Day", filterButton: true },
      { name: "Task #", filterButton: true },
      { name: "Title", filterButton: true },
      { name: "For date", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Description", filterButton: true },
    ],
    rows:
      assignments.length > 0
        ? assignments.map((a) => [
            a.dayNumber,
            a.taskNumber,
            a.task.title,
            ymd(a.forDate),
            a.status,
            a.task.description,
          ])
        : [["—", "—", "No tasks", "—", "—", "—"]],
  });
  const taskRowsN = Math.max(1, assignments.length) + 1;
  for (let r = 1; r <= taskRowsN; r++) {
    tasks.getRow(r).font = { size: 12 };
    tasks.getRow(r).height = 20;
  }
  tasks.getRow(1).font = { size: 13, bold: true };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `intern-report-${intern.user.fullName.replace(/\s+/g, "-").toLowerCase()}-full-${ymd(dataFrom)}_${ymd(dataTo)}.xlsx`;
  return { buffer, filename, fullName: intern.user.fullName };
}
