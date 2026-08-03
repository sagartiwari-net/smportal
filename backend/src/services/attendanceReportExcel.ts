import ExcelJS from "exceljs";
import { attendanceStatusDoughnut, monthlyAttendanceBarChart } from "./excelChartImages";

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
  title: "FF0F172A",
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

export type DayRosterRow = {
  student: string;
  email?: string | null;
  group: string;
  college: string;
  status: string;
  markedBy: string;
};

export async function buildDayAttendanceExcel(opts: {
  date: string;
  groupLabel: string;
  counts: { PRESENT: number; ABSENT: number; LEAVE: number; WEEK_OFF: number };
  rows: DayRosterRow[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";
  const total = opts.rows.length;
  const presentPct =
    opts.counts.PRESENT + opts.counts.ABSENT + opts.counts.LEAVE === 0
      ? 0
      : Math.round(
          (opts.counts.PRESENT / (opts.counts.PRESENT + opts.counts.ABSENT + opts.counts.LEAVE)) * 100,
        );

  const piePng = attendanceStatusDoughnut({
    present: opts.counts.PRESENT,
    absent: opts.counts.ABSENT,
    leave: opts.counts.LEAVE,
    weekOff: opts.counts.WEEK_OFF,
  });

  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 12;

  dash.mergeCells("A1:L1");
  dash.getCell("A1").value = "DAILY ATTENDANCE DASHBOARD";
  dash.getCell("A1").font = { size: 22, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  dash.getRow(1).height = 40;

  dash.mergeCells("A2:L2");
  dash.getCell("A2").value = `Date: ${opts.date}  ·  Group: ${opts.groupLabel}  ·  ${total} students`;
  dash.getCell("A2").font = { size: 13, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getRow(2).height = 26;

  dash.mergeCells("A3:L3");
  dash.getCell("A3").value = `Generated: ${ymd(new Date())}`;
  dash.getCell("A3").font = { size: 11, color: { argb: "FFCCFBF1" } };
  dash.getCell("A3").fill = fillSolid("FF134E4A");
  dash.getRow(3).height = 22;

  dash.mergeCells("A5:L5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);
  dash.getRow(5).height = 26;

  kpiCard(dash, 1, 6, "PRESENT", opts.counts.PRESENT, `${presentPct}% of counted`);
  kpiCard(dash, 3, 6, "ABSENT", opts.counts.ABSENT, "missing");
  kpiCard(dash, 5, 6, "LEAVE", opts.counts.LEAVE, "on leave");
  kpiCard(dash, 7, 6, "WEEK OFF", opts.counts.WEEK_OFF, "holiday / off");
  kpiCard(dash, 9, 6, "TOTAL", total, "students marked");

  dash.mergeCells("A10:L10");
  dash.getCell("A10").value = "CHART — attendance status mix";
  dash.getCell("A10").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A10").fill = fillSolid(C.header);
  for (let r = 11; r <= 26; r++) {
    dash.getRow(r).height = 16;
    for (let c = 1; c <= 12; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }
  const pieId = wb.addImage({ buffer: piePng, extension: "png" });
  dash.addImage(pieId, { tl: { col: 2.5, row: 10.9 }, ext: { width: 420, height: 300 } });

  const roster = wb.addWorksheet("Roster", { properties: { tabColor: { argb: "FF0D9488" } } });
  roster.columns = [{ width: 28 }, { width: 28 }, { width: 22 }, { width: 24 }, { width: 14 }, { width: 26 }];
  const dataRows =
    opts.rows.length > 0
      ? opts.rows.map((r) => [r.student, r.email || "—", r.group, r.college, r.status, r.markedBy])
      : [["—", "—", "—", "—", "NO_DATA", "—"]];
  roster.addTable({
    name: "DayRoster",
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
  for (let r = 1; r <= dataRows.length + 1; r++) {
    roster.getRow(r).font = { size: 12 };
    roster.getRow(r).height = 20;
  }
  fillHeader(roster.getRow(1));

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `attendance-day-${opts.date}.xlsx` };
}

export type PeriodDetailRow = {
  date: string;
  student: string;
  email?: string | null;
  group: string;
  college: string;
  status: string;
  markedBy: string;
};

export type PeriodDaySummary = {
  date: string;
  present: number;
  absent: number;
  leave: number;
  weekOff: number;
  total: number;
};

export async function buildPeriodAttendanceExcel(opts: {
  periodLabel: string;
  from: string;
  to: string;
  groupLabel: string;
  daySummaries: PeriodDaySummary[];
  details: PeriodDetailRow[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SMM Portal";

  const present = opts.details.filter((d) => d.status === "PRESENT").length;
  const absent = opts.details.filter((d) => d.status === "ABSENT").length;
  const leave = opts.details.filter((d) => d.status === "LEAVE").length;
  const weekOff = opts.details.filter((d) => d.status === "WEEK_OFF").length;
  const total = opts.details.length;
  const counted = present + absent + leave;
  const presentPct = counted === 0 ? 0 : Math.round((present / counted) * 100);

  const piePng = attendanceStatusDoughnut({ present, absent, leave, weekOff });
  const barPng = monthlyAttendanceBarChart(
    opts.daySummaries.length
      ? opts.daySummaries
          .slice()
          .reverse()
          .map((d) => ({
            label: d.date.slice(5),
            present: d.present,
            absent: d.absent,
            leave: d.leave,
            weekOff: d.weekOff,
          }))
      : [{ label: "No data", present: 0, absent: 0, leave: 0, weekOff: 0 }],
  );

  const dash = wb.addWorksheet("Dashboard", {
    views: [{ showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: C.header } },
  });
  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 12;

  dash.mergeCells("A1:L1");
  dash.getCell("A1").value = "ATTENDANCE PERIOD DASHBOARD";
  dash.getCell("A1").font = { size: 22, bold: true, color: { argb: C.headerText } };
  dash.getCell("A1").fill = fillSolid(C.header);
  dash.getRow(1).height = 40;

  dash.mergeCells("A2:L2");
  dash.getCell("A2").value =
    `${opts.periodLabel}  ·  ${opts.from} → ${opts.to}  ·  ${opts.groupLabel}  ·  ${total} records`;
  dash.getCell("A2").font = { size: 13, bold: true, color: { argb: C.headerText } };
  dash.getCell("A2").fill = fillSolid("FF115E59");
  dash.getRow(2).height = 26;

  dash.mergeCells("A3:L3");
  dash.getCell("A3").value = `Generated: ${ymd(new Date())}`;
  dash.getCell("A3").font = { size: 11, color: { argb: "FFCCFBF1" } };
  dash.getCell("A3").fill = fillSolid("FF134E4A");
  dash.getRow(3).height = 22;

  dash.mergeCells("A5:L5");
  dash.getCell("A5").value = "KEY METRICS";
  dash.getCell("A5").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A5").fill = fillSolid(C.header);

  kpiCard(dash, 1, 6, "PRESENT", present, `${presentPct}%`);
  kpiCard(dash, 3, 6, "ABSENT", absent, "days");
  kpiCard(dash, 5, 6, "LEAVE", leave, "days");
  kpiCard(dash, 7, 6, "WEEK OFF", weekOff, "days");
  kpiCard(dash, 9, 6, "TOTAL", total, `${opts.daySummaries.length} days`);

  dash.mergeCells("A10:L10");
  dash.getCell("A10").value = "CHARTS";
  dash.getCell("A10").font = { size: 14, bold: true, color: { argb: C.headerText } };
  dash.getCell("A10").fill = fillSolid(C.header);
  for (let r = 11; r <= 28; r++) {
    dash.getRow(r).height = 16;
    for (let c = 1; c <= 12; c++) dash.getCell(r, c).fill = fillSolid(C.panel);
  }
  const barId = wb.addImage({ buffer: barPng, extension: "png" });
  const pieId = wb.addImage({ buffer: piePng, extension: "png" });
  dash.addImage(barId, { tl: { col: 0.2, row: 10.9 }, ext: { width: 480, height: 280 } });
  dash.addImage(pieId, { tl: { col: 6.8, row: 10.9 }, ext: { width: 360, height: 280 } });

  const days = wb.addWorksheet("Days", { properties: { tabColor: { argb: "FF14B8A6" } } });
  days.columns = [{ width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
  const dayRows =
    opts.daySummaries.length > 0
      ? opts.daySummaries.map((d) => [d.date, d.present, d.absent, d.leave, d.weekOff, d.total])
      : [["—", 0, 0, 0, 0, 0]];
  days.addTable({
    name: "DaySummaries",
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
    ],
    rows: dayRows,
  });
  for (let r = 1; r <= dayRows.length + 1; r++) {
    days.getRow(r).font = { size: 12 };
    days.getRow(r).height = 20;
  }
  fillHeader(days.getRow(1));

  const detail = wb.addWorksheet("Details", { properties: { tabColor: { argb: "FF0D9488" } } });
  detail.columns = [
    { width: 14 },
    { width: 26 },
    { width: 26 },
    { width: 20 },
    { width: 22 },
    { width: 14 },
    { width: 24 },
  ];
  const detailRows =
    opts.details.length > 0
      ? opts.details.map((r) => [r.date, r.student, r.email || "—", r.group, r.college, r.status, r.markedBy])
      : [["—", "—", "—", "—", "—", "NO_DATA", "—"]];
  detail.addTable({
    name: "AttendanceDetails",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Student", filterButton: true },
      { name: "Email", filterButton: true },
      { name: "Group", filterButton: true },
      { name: "College", filterButton: true },
      { name: "Status", filterButton: true },
      { name: "Marked by", filterButton: true },
    ],
    rows: detailRows,
  });
  for (let r = 1; r <= Math.min(detailRows.length + 1, 5000); r++) {
    detail.getRow(r).font = { size: 12 };
    detail.getRow(r).height = 18;
  }
  fillHeader(detail.getRow(1));

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `attendance-period-${opts.from}_${opts.to}.xlsx` };
}
