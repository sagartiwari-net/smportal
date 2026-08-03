import ExcelJS from "exceljs";
import {
  attendanceStatusDoughnut,
  taskCompletionBar,
  taskStatusDoughnut,
} from "./excelChartImages";

function ymd(d: Date | string | null | undefined) {
  if (!d) return "—";
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

const C = {
  header: "FF166534",
  headerText: "FFFFFFFF",
  cardBg: "FFF0FDF4",
  cardBorder: "FF86EFAC",
  muted: "FF64748B",
  title: "FF0F172A",
  teal: "FF166534",
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

export type TaskExportRow = {
  student: string;
  email?: string | null;
  group: string;
  college: string;
  day: number;
  taskNo: number;
  title: string;
  forDate: string;
  status: string;
  assignedBy: string;
  submittedAt: string;
  lastReviewBy: string;
  lastReviewComment: string;
};

async function writeTasksWorkbook(opts: {
  title: string;
  subtitle: string;
  filterLabel: string;
  counts: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  rows: TaskExportRow[];
  filename: string;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";

  const total =
    opts.counts.ASSIGNED + opts.counts.SUBMITTED + opts.counts.NEEDS_IMPROVEMENT + opts.counts.DONE;
  const donePct = total === 0 ? 0 : Math.round((opts.counts.DONE / total) * 100);
  const notDone = total - opts.counts.DONE;

  const piePng = taskStatusDoughnut({
    assigned: opts.counts.ASSIGNED,
    submitted: opts.counts.SUBMITTED,
    needsImprovement: opts.counts.NEEDS_IMPROVEMENT,
    done: opts.counts.DONE,
  });
  const barPng = taskCompletionBar(opts.counts.DONE, total);

  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 12;

  dash.mergeCells("A1:L1");
  dash.getCell("A1").value = opts.title;
  dash.getCell("A1").font = { size: 22, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(1).height = 40;

  dash.mergeCells("A2:L2");
  dash.getCell("A2").value = opts.subtitle;
  dash.getCell("A2").font = { size: 13, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF14532D");
  dash.getCell("A2").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(2).height = 26;

  dash.mergeCells("A3:L3");
  dash.getCell("A3").value = `Filters: ${opts.filterLabel}  ·  Generated: ${ymd(new Date())}`;
  dash.getCell("A3").font = { size: 11, color: { argb: "FFDCFCE7" } };
  dash.getCell("A3").fill = fillSolid("FF166534");
  dash.getRow(3).height = 22;

  dash.mergeCells("A5:L5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);
  dash.getRow(5).height = 26;

  kpiCard(dash, 1, 6, "TOTAL", total, "assignments");
  kpiCard(dash, 3, 6, "DONE", opts.counts.DONE, `${donePct}% complete`);
  kpiCard(dash, 5, 6, "NOT DONE", notDone, "assigned + submitted + NI");
  kpiCard(dash, 7, 6, "ASSIGNED", opts.counts.ASSIGNED, "pending");
  kpiCard(dash, 9, 6, "SUBMITTED", opts.counts.SUBMITTED, "awaiting review");
  kpiCard(dash, 11, 6, "NEEDS WORK", opts.counts.NEEDS_IMPROVEMENT, "improvement");

  dash.mergeCells("A10:L10");
  dash.getCell("A10").value = "CHARTS — done vs remaining · status mix";
  dash.getCell("A10").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A10").fill = fillSolid(C.header);
  dash.getRow(10).height = 26;

  for (let r = 11; r <= 28; r++) {
    dash.getRow(r).height = 16;
    for (let c = 1; c <= 12; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }

  const pieId = wb.addImage({ buffer: piePng, extension: "png" });
  const barId = wb.addImage({ buffer: barPng, extension: "png" });
  dash.addImage(pieId, { tl: { col: 0.2, row: 10.9 }, ext: { width: 400, height: 300 } });
  dash.addImage(barId, { tl: { col: 5.5, row: 11.5 }, ext: { width: 480, height: 240 } });

  dash.mergeCells("A30:L30");
  dash.getCell("A30").value = "STATUS BREAKDOWN";
  dash.getCell("A30").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A30").fill = fillSolid(C.header);

  const breakdown: (string | number)[][] = [
    ["Assigned", opts.counts.ASSIGNED, total ? opts.counts.ASSIGNED / total : 0],
    ["Submitted", opts.counts.SUBMITTED, total ? opts.counts.SUBMITTED / total : 0],
    ["Needs improvement", opts.counts.NEEDS_IMPROVEMENT, total ? opts.counts.NEEDS_IMPROVEMENT / total : 0],
    ["Done", opts.counts.DONE, total ? opts.counts.DONE / total : 0],
  ];
  dash.addTable({
    name: "TaskStatusBreakdown",
    ref: "A32",
    headerRow: true,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [
      { name: "Status", filterButton: true },
      { name: "Count", filterButton: true },
      { name: "Share", filterButton: true },
    ],
    rows: breakdown,
  });
  for (let i = 0; i < 4; i++) {
    dash.getCell(33 + i, 3).numFmt = "0%";
    dash.getRow(33 + i).font = { size: 12 };
    dash.getRow(33 + i).height = 20;
  }
  dash.getRow(32).height = 22;

  const tasks = wb.addWorksheet("Tasks", { properties: { tabColor: { argb: "FF16A34A" } } });
  tasks.columns = [
    { width: 24 },
    { width: 26 },
    { width: 18 },
    { width: 20 },
    { width: 8 },
    { width: 8 },
    { width: 32 },
    { width: 12 },
    { width: 18 },
    { width: 20 },
    { width: 14 },
    { width: 18 },
    { width: 36 },
  ];
  const dataRows =
    opts.rows.length > 0
      ? opts.rows.map((r) => [
          r.student,
          r.email || "—",
          r.group,
          r.college,
          r.day,
          r.taskNo,
          r.title,
          r.forDate,
          r.status,
          r.assignedBy,
          r.submittedAt,
          r.lastReviewBy,
          r.lastReviewComment,
        ])
      : [["—", "—", "—", "—", "—", "—", "No tasks", "—", "—", "—", "—", "—", "—"]];

  tasks.addTable({
    name: "TasksExport",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Day", filterButton: true },
      { name: "Task #", filterButton: true },
      { name: "Title", filterButton: true },
      { name: "For date", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Assigned by", filterButton: true },
      { name: "Submitted", filterButton: true },
      { name: "Last review by", filterButton: true },
      { name: "Last review comment", filterButton: true },
    ],
    rows: dataRows,
  });
  for (let r = 1; r <= Math.min(dataRows.length + 1, 5000); r++) {
    tasks.getRow(r).font = { size: 11 };
    tasks.getRow(r).height = 18;
  }
  fillHeader(tasks.getRow(1));

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: opts.filename };
}

export async function buildTasksExcel(opts: {
  filterLabel: string;
  counts: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  rows: TaskExportRow[];
}) {
  return writeTasksWorkbook({
    title: "TASKS DASHBOARD",
    subtitle: `All matching assignments  ·  ${opts.rows.length} rows`,
    filterLabel: opts.filterLabel,
    counts: opts.counts,
    rows: opts.rows,
    filename: `tasks-export-${ymd(new Date())}.xlsx`,
  });
}

/** Single managed task × group (intern list view) */
export async function buildTaskBatchExcel(opts: {
  taskLabel: string;
  groupName: string;
  forDate: string;
  description?: string;
  assignedBy?: string;
  counts: { ASSIGNED: number; SUBMITTED: number; NEEDS_IMPROVEMENT: number; DONE: number };
  rows: TaskExportRow[];
}) {
  const safe = opts.taskLabel.replace(/[^\w\-]+/g, "-").slice(0, 40).toLowerCase();
  return writeTasksWorkbook({
    title: "TASK MANAGE DASHBOARD",
    subtitle: `${opts.taskLabel}  ·  ${opts.groupName}  ·  ${opts.forDate}${
      opts.assignedBy ? `  ·  Assigned by ${opts.assignedBy}` : ""
    }`,
    filterLabel: `task batch · ${opts.groupName}${opts.description ? ` · ${opts.description.slice(0, 60)}` : ""}`,
    counts: opts.counts,
    rows: opts.rows,
    filename: `task-manage-${safe}-${ymd(new Date())}.xlsx`,
  });
}
