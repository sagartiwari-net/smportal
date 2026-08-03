import { api } from "../api/client";

type PrintReport = {
  filterLabel: string;
  generatedAt: string;
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
  students: {
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
  }[];
  tasks: {
    student: string;
    college: string;
    group: string;
    day: number;
    taskNo: number;
    title: string;
    forDate: string;
    status: string;
  }[];
  attendanceDays: {
    date: string;
    present: number;
    absent: number;
    leave: number;
    weekOff: number;
    total: number;
    presentPct: number;
  }[];
  colleges: {
    name: string;
    students: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
  }[];
  groups: {
    name: string;
    students: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    tasksDone: number;
    tasksTotal: number;
  }[];
  charts: {
    taskStatus: string;
    attendanceMix: string;
    attendanceTrend: string;
    topStudents: string;
    colleges: string;
  };
};

function esc(s: string | number) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function table(headers: string[], rows: (string | number)[][]) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" style="color:#64748b">No data</td></tr>`
      : rows
          .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
          .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildPrintHtml(r: PrintReport) {
  const s = r.summary;
  const ts = r.taskStatus;
  const ac = r.attendanceCounts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SMM Analytics Report — ${esc(r.generatedAt)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #0f172a;
    background: #fff;
    font-size: 11px;
    line-height: 1.4;
  }
  .banner {
    background: linear-gradient(135deg, #0f766e, #115e59);
    color: #fff;
    padding: 18px 20px;
    border-radius: 10px;
    margin-bottom: 16px;
  }
  .banner h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0.02em; }
  .banner p { margin: 0; opacity: 0.92; font-size: 12px; }
  .kpis {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }
  .kpi {
    border: 2px solid #5eead4;
    background: #f0fdfa;
    border-radius: 10px;
    padding: 10px 8px;
    text-align: center;
  }
  .kpi .label { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi .value { font-size: 20px; font-weight: 800; color: #0f766e; margin-top: 4px; }
  .kpi .sub { font-size: 9px; color: #64748b; margin-top: 2px; }
  h2 {
    margin: 20px 0 8px;
    padding: 8px 12px;
    background: #0f766e;
    color: #fff;
    font-size: 13px;
    border-radius: 6px;
  }
  .charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 8px;
  }
  .charts.wide { grid-template-columns: 1fr; }
  .chart-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 8px;
    background: #f8fafc;
    text-align: center;
  }
  .chart-card img { max-width: 100%; height: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 5px 6px;
    text-align: left;
  }
  th { background: #0f766e; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .meta { color: #64748b; font-size: 10px; margin-bottom: 12px; }
  .page-break { page-break-before: always; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 10px 0 14px; background: #fff;
  }
  .toolbar button {
    border: none; border-radius: 8px; padding: 8px 14px;
    font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .btn-print { background: #16a34a; color: #fff; }
  .btn-close { background: #e2e8f0; color: #0f172a; }
  @media print {
    .toolbar { display: none !important; }
    .banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2, th, .kpi { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-close" onclick="window.close()">Close</button>
    <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="banner">
    <h1>SMM Portal · Analytics Full Report</h1>
    <p>${esc(r.filterLabel)}</p>
  </div>
  <p class="meta">Generated: ${esc(r.generatedAt)} · Score = 0.5×attendance + 0.5×task completion</p>

  <div class="kpis">
    <div class="kpi"><div class="label">Students</div><div class="value">${s.students}</div><div class="sub">in scope</div></div>
    <div class="kpi"><div class="label">Avg score</div><div class="value">${s.avgScore}%</div><div class="sub">overall</div></div>
    <div class="kpi"><div class="label">Avg attendance</div><div class="value">${s.avgAttendance}%</div><div class="sub">present rate</div></div>
    <div class="kpi"><div class="label">Avg tasks</div><div class="value">${s.avgTasks}%</div><div class="sub">completion</div></div>
    <div class="kpi"><div class="label">Task rows</div><div class="value">${s.totalAssignments}</div><div class="sub">assignments</div></div>
    <div class="kpi"><div class="label">Att. rows</div><div class="value">${s.totalAttendanceRows}</div><div class="sub">marked</div></div>
  </div>

  <h2>Overview dashboard</h2>
  <div class="charts">
    <div class="chart-card"><img src="${r.charts.taskStatus}" alt="Task status" /></div>
    <div class="chart-card"><img src="${r.charts.attendanceMix}" alt="Attendance mix" /></div>
  </div>
  <div class="charts wide">
    <div class="chart-card"><img src="${r.charts.topStudents}" alt="Top students" /></div>
  </div>
  <div class="charts wide">
    <div class="chart-card"><img src="${r.charts.attendanceTrend}" alt="Attendance trend" /></div>
  </div>
  <div class="charts wide">
    <div class="chart-card"><img src="${r.charts.colleges}" alt="College comparison" /></div>
  </div>

  <p class="meta">
    Tasks — Done ${ts.DONE} · Submitted ${ts.SUBMITTED} · Needs work ${ts.NEEDS_IMPROVEMENT} · Assigned ${ts.ASSIGNED}
    &nbsp;|&nbsp;
    Attendance — Present ${ac.PRESENT} · Absent ${ac.ABSENT} · Leave ${ac.LEAVE} · Week off ${ac.WEEK_OFF}
  </p>

  <div class="page-break"></div>
  <h2>Leaderboard (${r.students.length})</h2>
  ${table(
    ["#", "Student", "College", "Group", "Score %", "Att %", "Tasks %", "Done/Total"],
    r.students.map((x) => [
      x.rank,
      x.fullName,
      x.college,
      x.groupName,
      x.score,
      x.attendanceRate,
      x.taskCompletionRate,
      `${x.doneTasks}/${x.totalTasks}`,
    ]),
  )}

  <div class="page-break"></div>
  <h2>Colleges (${r.colleges.length})</h2>
  ${table(
    ["College", "Students", "Avg score", "Avg attendance", "Avg tasks"],
    r.colleges.map((c) => [c.name, c.students, c.avgScore, c.avgAttendance, c.avgTasks]),
  )}

  <h2>Groups (${r.groups.length})</h2>
  ${table(
    ["Group", "Students", "Avg score", "Avg attendance", "Avg tasks", "Tasks done", "Tasks total"],
    r.groups.map((g) => [g.name, g.students, g.avgScore, g.avgAttendance, g.avgTasks, g.tasksDone, g.tasksTotal]),
  )}

  <div class="page-break"></div>
  <h2>Attendance by day (${r.attendanceDays.length})</h2>
  ${table(
    ["Date", "Present", "Absent", "Leave", "Week off", "Total", "Present %"],
    r.attendanceDays.map((d) => [d.date, d.present, d.absent, d.leave, d.weekOff, d.total, d.presentPct]),
  )}

  <div class="page-break"></div>
  <h2>Tasks detail (${r.tasks.length})</h2>
  ${table(
    ["Student", "College", "Group", "Day", "Task #", "Title", "For date", "Status"],
    r.tasks.map((t) => [t.student, t.college, t.group, t.day, t.taskNo, t.title, t.forDate, t.status]),
  )}

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.print(), 400);
    });
  </script>
</body>
</html>`;
}

/** Open a professional print window (not screen print). */
export async function openAnalyticsPrintReport(queryString: string) {
  const { data } = await api.get(`/analytics/report${queryString ? `?${queryString}` : ""}`, {
    timeout: 300_000,
  });
  const html = buildPrintHtml(data as PrintReport);
  const w = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");
  if (!w) throw new Error("Popup blocked");
  w.document.open();
  w.document.write(html);
  w.document.close();
}
