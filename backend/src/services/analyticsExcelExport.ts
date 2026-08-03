import ExcelJS from "exceljs";
import {
  attendanceStatusDoughnut,
  metricCompareBar,
  monthlyAttendanceBarChart,
  taskStatusDoughnut,
} from "./excelChartImages";

function ymd(d: Date | string) {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

const C = {
  header: "FF0F766E",
  headerText: "FFFFFFFF",
  cardBg: "FFF0FDFA",
  cardBorder: "FF5EEAD4",
  muted: "FF64748B",
  teal: "FF0F766E",
  panel: "FFF8FAFC",
};

function fillSolid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function fillHeader(row: ExcelJS.Row) {
  row.font = { bold: true, size: 12, color: { argb: C.headerText } };
  row.fill = fillSolid(C.header);
  row.height = 22;
}

function kpiCard(
  sheet: ExcelJS.Worksheet,
  col: number,
  row: number,
  label: string,
  value: string | number,
  sub?: string,
) {
  const end = col + 1;
  sheet.mergeCells(row, col, row, end);
  sheet.mergeCells(row + 1, col, row + 1, end);
  sheet.mergeCells(row + 2, col, row + 2, end);
  for (let r = row; r <= row + 2; r++) {
    for (let c = col; c <= end; c++) {
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
  sheet.getCell(row, col).value = label;
  sheet.getCell(row, col).font = { size: 11, bold: true, color: { argb: C.muted } };
  sheet.getCell(row, col).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell(row + 1, col).value = value;
  sheet.getCell(row + 1, col).font = { size: 24, bold: true, color: { argb: C.teal } };
  sheet.getCell(row + 1, col).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell(row + 2, col).value = sub || "";
  sheet.getCell(row + 2, col).font = { size: 10, color: { argb: C.muted } };
  sheet.getCell(row + 2, col).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(row).height = 20;
  sheet.getRow(row + 1).height = 34;
  sheet.getRow(row + 2).height = 18;
}

function styleTable(sheet: ExcelJS.Worksheet, rowCount: number) {
  for (let r = 1; r <= rowCount + 1; r++) {
    sheet.getRow(r).font = { size: 11 };
    sheet.getRow(r).height = 20;
  }
  fillHeader(sheet.getRow(1));
}

export type FullReportStudent = {
  rank: number;
  fullName: string;
  email: string;
  college: string;
  groupName: string;
  score: number;
  attendanceRate: number;
  taskCompletionRate: number;
  doneTasks: number;
  totalTasks: number;
  present: number;
  absent: number;
  leave: number;
};

export type FullReportTaskRow = {
  student: string;
  email: string;
  college: string;
  group: string;
  day: number;
  taskNo: number;
  title: string;
  forDate: string;
  status: string;
};

export type FullReportAttRow = {
  date: string;
  student: string;
  email: string;
  college: string;
  group: string;
  status: string;
  markedBy: string;
};

export type FullReportDaySummary = {
  date: string;
  present: number;
  absent: number;
  leave: number;
  weekOff: number;
  total: number;
  presentPct: number;
};

export type FullReportAgg = {
  name: string;
  students: number;
  avgScore: number;
  avgAttendance: number;
  avgTasks: number;
  tasksDone: number;
  tasksTotal: number;
};

export type FullAnalyticsPayload = {
  filterLabel: string;
  summary: {
    students: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    totalAssignments: number;
    totalAttendanceRows: number;
  };
  taskStatus: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  attendanceCounts: { PRESENT: number; ABSENT: number; LEAVE: number; WEEK_OFF: number };
  students: FullReportStudent[];
  tasks: FullReportTaskRow[];
  attendanceDays: FullReportDaySummary[];
  attendanceDetails: FullReportAttRow[];
  colleges: FullReportAgg[];
  groups: FullReportAgg[];
};

function buildCharts(data: FullAnalyticsPayload) {
  const ts = data.taskStatus;
  const ac = data.attendanceCounts;
  const taskPng = taskStatusDoughnut({
    assigned: ts.ASSIGNED,
    submitted: ts.SUBMITTED,
    needsImprovement: ts.NEEDS_IMPROVEMENT,
    done: ts.DONE,
  });
  const attMixPng = attendanceStatusDoughnut({
    present: ac.PRESENT,
    absent: ac.ABSENT,
    leave: ac.LEAVE,
    weekOff: ac.WEEK_OFF,
  });
  const trendPng = monthlyAttendanceBarChart(
    data.attendanceDays
      .slice()
      .reverse()
      .slice(-40)
      .map((d) => ({
        label: d.date.slice(5),
        present: d.present,
        absent: d.absent,
        leave: d.leave,
        weekOff: d.weekOff,
      })),
  );
  const topPng = metricCompareBar(
    data.students.slice(0, 12).map((s) => ({
      label: s.fullName.split(" ")[0] || s.fullName,
      score: s.score,
      attendance: s.attendanceRate,
      tasks: s.taskCompletionRate,
    })),
    "Top students — score · attendance · tasks",
  );
  const collegePng = metricCompareBar(
    data.colleges.slice(0, 12).map((c) => ({
      label: c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name,
      score: c.avgScore,
      attendance: c.avgAttendance,
      tasks: c.avgTasks,
    })),
    "College comparison",
  );
  return { taskPng, attMixPng, trendPng, topPng, collegePng };
}

/** Full multi-sheet analytics workbook — Overview + all detail sheets */
export async function buildFullAnalyticsExcel(data: FullAnalyticsPayload) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";
  const charts = buildCharts(data);

  // ——— Overview dashboard ———
  const dash = wb.addWorksheet("Overview", {
    views: [{ showGridLines: false, zoomScale: 95 }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 14; c++) dash.getColumn(c).width = 11;

  dash.mergeCells("A1:N1");
  dash.getCell("A1").value = "SMM PORTAL · ANALYTICS FULL REPORT";
  dash.getCell("A1").font = { size: 22, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(1).height = 40;

  dash.mergeCells("A2:N2");
  dash.getCell("A2").value = data.filterLabel;
  dash.getCell("A2").font = { size: 13, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getRow(2).height = 26;

  dash.mergeCells("A3:N3");
  dash.getCell("A3").value =
    `Generated: ${ymd(new Date())}  ·  ${data.summary.students} students  ·  ${data.summary.totalAssignments} tasks  ·  ${data.summary.totalAttendanceRows} attendance rows`;
  dash.getCell("A3").font = { size: 11, color: { argb: "FFCCFBF1" } };
  dash.getCell("A3").fill = fillSolid("FF134E4A");
  dash.getRow(3).height = 22;

  dash.mergeCells("A5:N5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);
  dash.getRow(5).height = 26;

  kpiCard(dash, 1, 6, "STUDENTS", data.summary.students, "in scope");
  kpiCard(dash, 3, 6, "AVG SCORE", `${data.summary.avgScore}%`, "overall");
  kpiCard(dash, 5, 6, "AVG ATTENDANCE", `${data.summary.avgAttendance}%`, "present rate");
  kpiCard(dash, 7, 6, "AVG TASKS", `${data.summary.avgTasks}%`, "completion");
  kpiCard(dash, 9, 6, "TASK ROWS", data.summary.totalAssignments, "assignments");
  kpiCard(dash, 11, 6, "ATT. ROWS", data.summary.totalAttendanceRows, "marked days");

  dash.mergeCells("A10:N10");
  dash.getCell("A10").value = "CHARTS";
  dash.getCell("A10").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A10").fill = fillSolid(C.header);
  for (let r = 11; r <= 48; r++) {
    dash.getRow(r).height = 15;
    for (let c = 1; c <= 14; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }

  const idTask = wb.addImage({ buffer: charts.taskPng, extension: "png" });
  const idAtt = wb.addImage({ buffer: charts.attMixPng, extension: "png" });
  const idTop = wb.addImage({ buffer: charts.topPng, extension: "png" });
  const idTrend = wb.addImage({ buffer: charts.trendPng, extension: "png" });
  const idCollege = wb.addImage({ buffer: charts.collegePng, extension: "png" });

  dash.addImage(idTask, { tl: { col: 0.3, row: 10.8 }, ext: { width: 380, height: 290 } });
  dash.addImage(idAtt, { tl: { col: 7.2, row: 10.8 }, ext: { width: 380, height: 290 } });
  dash.addImage(idTop, { tl: { col: 0.3, row: 28.5 }, ext: { width: 780, height: 320 } });
  dash.addImage(idTrend, { tl: { col: 0.3, row: 48 }, ext: { width: 780, height: 300 } });
  for (let r = 49; r <= 70; r++) {
    dash.getRow(r).height = 15;
    for (let c = 1; c <= 14; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }
  dash.addImage(idCollege, { tl: { col: 0.3, row: 68 }, ext: { width: 780, height: 320 } });
  for (let r = 71; r <= 92; r++) {
    dash.getRow(r).height = 15;
    for (let c = 1; c <= 14; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }

  // ——— Leaderboard ———
  const lb = wb.addWorksheet("Leaderboard", { properties: { tabColor: { argb: "FF166534" } } });
  lb.columns = [
    { width: 8 },
    { width: 26 },
    { width: 28 },
    { width: 22 },
    { width: 18 },
    { width: 10 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
  ];
  const lbRows =
    data.students.length > 0
      ? data.students.map((s) => [
          s.rank,
          s.fullName,
          s.email,
          s.college,
          s.groupName,
          s.score,
          s.attendanceRate,
          s.taskCompletionRate,
          s.doneTasks,
          s.totalTasks,
          s.present,
          s.absent,
          s.leave,
        ])
      : [["—", "—", "—", "—", "—", 0, 0, 0, 0, 0, 0, 0, 0]];
  lb.addTable({
    name: "LeaderboardTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Rank", filterButton: true },
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "Score %", filterButton: true },
      { name: "Att %", filterButton: true },
      { name: "Tasks %", filterButton: true },
      { name: "Done", filterButton: true },
      { name: "Total tasks", filterButton: true },
      { name: "Present", filterButton: true },
      { name: "Absent", filterButton: true },
      { name: "Leave", filterButton: true },
    ],
    rows: lbRows,
  });
  styleTable(lb, lbRows.length);

  // ——— Tasks ———
  const tasks = wb.addWorksheet("Tasks", { properties: { tabColor: { argb: "FF0D9488" } } });
  tasks.columns = [
    { width: 24 },
    { width: 26 },
    { width: 20 },
    { width: 16 },
    { width: 8 },
    { width: 8 },
    { width: 32 },
    { width: 12 },
    { width: 16 },
  ];
  const taskRows =
    data.tasks.length > 0
      ? data.tasks.map((t) => [
          t.student,
          t.email,
          t.college,
          t.group,
          t.day,
          t.taskNo,
          t.title,
          t.forDate,
          t.status,
        ])
      : [["—", "—", "—", "—", 0, 0, "NO_DATA", "—", "—"]];
  tasks.addTable({
    name: "TasksTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "Day", filterButton: true },
      { name: "Task #", filterButton: true },
      { name: "Title", filterButton: true },
      { name: "For date", filterButton: true },
      { name: "Status", filterButton: true },
    ],
    rows: taskRows,
  });
  styleTable(tasks, taskRows.length);

  // ——— Attendance Days ———
  const days = wb.addWorksheet("Attendance Days", { properties: { tabColor: { argb: "FF0284C8" } } });
  days.columns = [{ width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
  const dayRows =
    data.attendanceDays.length > 0
      ? data.attendanceDays.map((d) => [
          d.date,
          d.present,
          d.absent,
          d.leave,
          d.weekOff,
          d.total,
          d.presentPct,
        ])
      : [["—", 0, 0, 0, 0, 0, 0]];
  days.addTable({
    name: "AttendanceDaysTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Present", filterButton: true },
      { name: "Absent", filterButton: true },
      { name: "Leave", filterButton: true },
      { name: "Week off", filterButton: true },
      { name: "Total", filterButton: true },
      { name: "Present %", filterButton: true },
    ],
    rows: dayRows,
  });
  styleTable(days, dayRows.length);

  // ——— Attendance Detail ———
  const att = wb.addWorksheet("Attendance Detail", { properties: { tabColor: { argb: "FF0369A1" } } });
  att.columns = [
    { width: 12 },
    { width: 24 },
    { width: 26 },
    { width: 20 },
    { width: 16 },
    { width: 12 },
    { width: 24 },
  ];
  const attRows =
    data.attendanceDetails.length > 0
      ? data.attendanceDetails.map((r) => [
          r.date,
          r.student,
          r.email,
          r.college,
          r.group,
          r.status,
          r.markedBy,
        ])
      : [["—", "—", "—", "—", "—", "NO_DATA", "—"]];
  att.addTable({
    name: "AttendanceDetailTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Marked by", filterButton: true },
    ],
    rows: attRows,
  });
  styleTable(att, attRows.length);

  // ——— Colleges ———
  const colleges = wb.addWorksheet("Colleges", { properties: { tabColor: { argb: "FFCA8A04" } } });
  colleges.columns = [
    { width: 28 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
  const collegeRows =
    data.colleges.length > 0
      ? data.colleges.map((c) => [
          c.name,
          c.students,
          c.avgScore,
          c.avgAttendance,
          c.avgTasks,
          c.tasksDone,
          c.tasksTotal,
        ])
      : [["—", 0, 0, 0, 0, 0, 0]];
  colleges.addTable({
    name: "CollegesTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "College", filterButton: true },
      { name: "Students", filterButton: true },
      { name: "Avg score", filterButton: true },
      { name: "Avg attendance", filterButton: true },
      { name: "Avg tasks", filterButton: true },
      { name: "Tasks done", filterButton: true },
      { name: "Tasks total", filterButton: true },
    ],
    rows: collegeRows,
  });
  styleTable(colleges, collegeRows.length);

  // ——— Groups ———
  const groups = wb.addWorksheet("Groups", { properties: { tabColor: { argb: "FFEA580C" } } });
  groups.columns = [
    { width: 28 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
  const groupRows =
    data.groups.length > 0
      ? data.groups.map((g) => [
          g.name,
          g.students,
          g.avgScore,
          g.avgAttendance,
          g.avgTasks,
          g.tasksDone,
          g.tasksTotal,
        ])
      : [["—", 0, 0, 0, 0, 0, 0]];
  groups.addTable({
    name: "GroupsTable",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Group", filterButton: true },
      { name: "Students", filterButton: true },
      { name: "Avg score", filterButton: true },
      { name: "Avg attendance", filterButton: true },
      { name: "Avg tasks", filterButton: true },
      { name: "Tasks done", filterButton: true },
      { name: "Tasks total", filterButton: true },
    ],
    rows: groupRows,
  });
  styleTable(groups, groupRows.length);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `analytics-full-report-${ymd(new Date())}.xlsx`,
    charts,
  };
}

/** Build print/report payload with base64 chart images */
export function buildFullAnalyticsPrintPayload(data: FullAnalyticsPayload) {
  const charts = buildCharts(data);
  const toB64 = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;
  return {
    ...data,
    generatedAt: ymd(new Date()),
    charts: {
      taskStatus: toB64(charts.taskPng),
      attendanceMix: toB64(charts.attMixPng),
      attendanceTrend: toB64(charts.trendPng),
      topStudents: toB64(charts.topPng),
      colleges: toB64(charts.collegePng),
    },
  };
}

// Re-export older builders from the previous file content — keep day/scope helpers below
export type AnalyticsStudentRow = {
  fullName: string;
  email: string;
  college: string;
  groupName: string;
  score: number;
  attendanceRate: number;
  taskCompletionRate: number;
  doneTasks: number;
  totalTasks: number;
};

export type AnalyticsAggRow = {
  name: string;
  count: number;
  avgScore: number;
  avgAttendance: number;
  avgTasks: number;
  tasksDone?: number;
  tasksTotal?: number;
};

export async function buildAnalyticsScopeExcel(opts: {
  title: string;
  subtitle: string;
  filename: string;
  summary: {
    count: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    totalAssignments?: number;
  };
  taskStatus?: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  attendanceTrend?: { date: string; present: number; total: number; rate?: number }[];
  students: AnalyticsStudentRow[];
  relatedGroups?: AnalyticsAggRow[];
  relatedColleges?: AnalyticsAggRow[];
  byCollege?: AnalyticsAggRow[];
  byGroup?: AnalyticsAggRow[];
}) {
  // Narrow drill export — map into full payload subset for consistency
  const payload: FullAnalyticsPayload = {
    filterLabel: opts.subtitle,
    summary: {
      students: opts.summary.count,
      avgScore: opts.summary.avgScore,
      avgAttendance: opts.summary.avgAttendance,
      avgTasks: opts.summary.avgTasks,
      totalAssignments: opts.summary.totalAssignments ?? 0,
      totalAttendanceRows: 0,
    },
    taskStatus: opts.taskStatus || { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 },
    attendanceCounts: { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 },
    students: opts.students.map((s, i) => ({
      rank: i + 1,
      fullName: s.fullName,
      email: s.email,
      college: s.college,
      groupName: s.groupName,
      score: s.score,
      attendanceRate: s.attendanceRate,
      taskCompletionRate: s.taskCompletionRate,
      doneTasks: s.doneTasks,
      totalTasks: s.totalTasks,
      present: 0,
      absent: 0,
      leave: 0,
    })),
    tasks: [],
    attendanceDays: (opts.attendanceTrend || []).map((d) => ({
      date: d.date,
      present: d.present,
      absent: Math.max(0, d.total - d.present),
      leave: 0,
      weekOff: 0,
      total: d.total,
      presentPct: d.rate ?? (d.total ? Math.round((d.present / d.total) * 100) : 0),
    })),
    attendanceDetails: [],
    colleges: (opts.byCollege || opts.relatedColleges || []).map((c) => ({
      name: c.name,
      students: c.count,
      avgScore: c.avgScore,
      avgAttendance: c.avgAttendance,
      avgTasks: c.avgTasks,
      tasksDone: c.tasksDone ?? 0,
      tasksTotal: c.tasksTotal ?? 0,
    })),
    groups: (opts.byGroup || opts.relatedGroups || []).map((g) => ({
      name: g.name,
      students: g.count,
      avgScore: g.avgScore,
      avgAttendance: g.avgAttendance,
      avgTasks: g.avgTasks,
      tasksDone: g.tasksDone ?? 0,
      tasksTotal: g.tasksTotal ?? 0,
    })),
  };

  const { buffer } = await buildFullAnalyticsExcel(payload);
  // Rebuild with custom title on Overview — quick patch via workbook rewrite is heavy;
  // instead write a slim scoped workbook for drill-downs
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";
  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 12;
  dash.mergeCells("A1:L1");
  dash.getCell("A1").value = opts.title;
  dash.getCell("A1").font = { size: 20, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getRow(1).height = 38;
  dash.mergeCells("A2:L2");
  dash.getCell("A2").value = opts.subtitle;
  dash.getCell("A2").font = { size: 12, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getRow(2).height = 24;
  dash.mergeCells("A3:L3");
  dash.getCell("A3").value = `Generated: ${ymd(new Date())}`;
  dash.getCell("A3").font = { size: 11, color: { argb: "FFCCFBF1" } };
  dash.getCell("A3").fill = fillSolid("FF134E4A");
  dash.mergeCells("A5:L5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);
  kpiCard(dash, 1, 6, "STUDENTS", opts.summary.count, "in this view");
  kpiCard(dash, 3, 6, "AVG SCORE", `${opts.summary.avgScore}%`, "overall");
  kpiCard(dash, 5, 6, "AVG ATTENDANCE", `${opts.summary.avgAttendance}%`, "present rate");
  kpiCard(dash, 7, 6, "AVG TASKS", `${opts.summary.avgTasks}%`, "completion");
  kpiCard(dash, 9, 6, "ASSIGNMENTS", opts.summary.totalAssignments ?? 0, "task rows");

  const ts = opts.taskStatus || { ASSIGNED: 0, SUBMITTED: 0, NEEDS_IMPROVEMENT: 0, DONE: 0 };
  const taskTotal = ts.ASSIGNED + ts.SUBMITTED + ts.NEEDS_IMPROVEMENT + ts.DONE;
  let nextRow = 10;
  if (taskTotal > 0) {
    dash.mergeCells(`A${nextRow}:L${nextRow}`);
    dash.getCell(`A${nextRow}`).value = "CHART — task status";
    dash.getCell(`A${nextRow}`).font = { size: 14, bold: true, color: { argb: C.headerText } };
    dash.getCell(`A${nextRow}`).fill = fillSolid(C.header);
    for (let r = nextRow + 1; r <= nextRow + 16; r++) {
      dash.getRow(r).height = 16;
      for (let c = 1; c <= 12; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
    }
    const pie = taskStatusDoughnut({
      assigned: ts.ASSIGNED,
      submitted: ts.SUBMITTED,
      needsImprovement: ts.NEEDS_IMPROVEMENT,
      done: ts.DONE,
    });
    dash.addImage(wb.addImage({ buffer: pie, extension: "png" }), {
      tl: { col: 2.5, row: nextRow + 0.9 },
      ext: { width: 420, height: 280 },
    });
    nextRow += 18;
  }

  const students = wb.addWorksheet("Students", { properties: { tabColor: { argb: "FF0D9488" } } });
  students.columns = [
    { width: 26 },
    { width: 28 },
    { width: 22 },
    { width: 18 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
  const sRows =
    opts.students.length > 0
      ? opts.students.map((r) => [
          r.fullName,
          r.email,
          r.college,
          r.groupName,
          r.score,
          r.attendanceRate,
          r.taskCompletionRate,
          r.doneTasks,
          r.totalTasks,
        ])
      : [["—", "—", "—", "—", 0, 0, 0, 0, 0]];
  students.addTable({
    name: "ScopeStudents",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "Score %", filterButton: true },
      { name: "Attendance %", filterButton: true },
      { name: "Tasks %", filterButton: true },
      { name: "Done", filterButton: true },
      { name: "Total tasks", filterButton: true },
    ],
    rows: sRows,
  });
  styleTable(students, sRows.length);

  function addAgg(name: string, rows: AnalyticsAggRow[], includeTasks: boolean) {
    if (!rows.length) return;
    const sheet = wb.addWorksheet(name, { properties: { tabColor: { argb: "FF0D9488" } } });
    sheet.columns = includeTasks
      ? [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }]
      : [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }];
    const dataRows = rows.map((r) =>
      includeTasks
        ? [r.name, r.count, r.avgScore, r.avgAttendance, r.avgTasks, r.tasksDone ?? 0, r.tasksTotal ?? 0]
        : [r.name, r.count, r.avgScore, r.avgAttendance, r.avgTasks],
    );
    sheet.addTable({
      name: name.replace(/\W/g, "") + "T",
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: includeTasks
        ? [
            { name: "Name", filterButton: true },
            { name: "Students", filterButton: true },
            { name: "Avg score", filterButton: true },
            { name: "Avg attendance", filterButton: true },
            { name: "Avg tasks", filterButton: true },
            { name: "Tasks done", filterButton: true },
            { name: "Tasks total", filterButton: true },
          ]
        : [
            { name: "Name", filterButton: true },
            { name: "Students", filterButton: true },
            { name: "Avg score", filterButton: true },
            { name: "Avg attendance", filterButton: true },
            { name: "Avg tasks", filterButton: true },
          ],
      rows: dataRows,
    });
    styleTable(sheet, dataRows.length);
  }
  addAgg("Related groups", opts.relatedGroups ?? [], false);
  addAgg("Related colleges", opts.relatedColleges ?? [], false);
  addAgg("By college", opts.byCollege ?? [], false);
  addAgg("By group", opts.byGroup ?? [], true);

  void buffer; // unused — scoped uses its own workbook
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer: out, filename: opts.filename };
}

export async function buildAnalyticsDayExcel(opts: {
  date: string;
  filterLabel: string;
  counts: { PRESENT: number; ABSENT: number; LEAVE: number; WEEK_OFF: number };
  rows: {
    student: string;
    email?: string | null;
    group: string;
    college: string;
    status: string;
    markedBy: string;
  }[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";
  const total = opts.rows.length;
  const counted = opts.counts.PRESENT + opts.counts.ABSENT + opts.counts.LEAVE;
  const presentPct = counted === 0 ? 0 : Math.round((opts.counts.PRESENT / counted) * 100);
  const piePng = attendanceStatusDoughnut({
    present: opts.counts.PRESENT,
    absent: opts.counts.ABSENT,
    leave: opts.counts.LEAVE,
    weekOff: opts.counts.WEEK_OFF,
  });

  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 12;
  dash.mergeCells("A1:L1");
  dash.getCell("A1").value = "ANALYTICS · DAILY ATTENDANCE";
  dash.getCell("A1").font = { size: 20, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getRow(1).height = 38;
  dash.mergeCells("A2:L2");
  dash.getCell("A2").value = `Date: ${opts.date}  ·  ${opts.filterLabel}  ·  ${total} students`;
  dash.getCell("A2").font = { size: 12, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getRow(2).height = 24;
  dash.mergeCells("A5:L5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);
  kpiCard(dash, 1, 6, "PRESENT", opts.counts.PRESENT, `${presentPct}% counted`);
  kpiCard(dash, 3, 6, "ABSENT", opts.counts.ABSENT, "missing");
  kpiCard(dash, 5, 6, "LEAVE", opts.counts.LEAVE, "on leave");
  kpiCard(dash, 7, 6, "WEEK OFF", opts.counts.WEEK_OFF, "holiday / off");
  kpiCard(dash, 9, 6, "TOTAL", total, "marked");
  dash.mergeCells("A10:L10");
  dash.getCell("A10").value = "CHART — attendance status mix";
  dash.getCell("A10").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A10").fill = fillSolid(C.header);
  for (let r = 11; r <= 26; r++) {
    dash.getRow(r).height = 16;
    for (let c = 1; c <= 12; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }
  dash.addImage(wb.addImage({ buffer: piePng, extension: "png" }), {
    tl: { col: 2.5, row: 10.9 },
    ext: { width: 420, height: 300 },
  });

  const roster = wb.addWorksheet("Roster", { properties: { tabColor: { argb: "FF0D9488" } } });
  roster.columns = [{ width: 28 }, { width: 28 }, { width: 22 }, { width: 24 }, { width: 14 }, { width: 26 }];
  const dataRows =
    opts.rows.length > 0
      ? opts.rows.map((r) => [r.student, r.email || "—", r.group, r.college, r.status, r.markedBy])
      : [["—", "—", "—", "—", "NO_DATA", "—"]];
  roster.addTable({
    name: "AnalyticsDayRoster",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Marked by", filterButton: true },
    ],
    rows: dataRows,
  });
  styleTable(roster, dataRows.length);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `analytics-day-${opts.date}.xlsx` };
}
