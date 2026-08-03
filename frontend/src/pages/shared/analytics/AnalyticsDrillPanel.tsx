import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { api } from "../../../api/client";
import { downloadExcel } from "../../../api/downloadExcel";

const GREEN = "#16a34a";
const TEAL = "#0d9488";
const AMBER = "#d97706";
const ROSE = "#e11d48";
const SLATE = "#64748b";
const SKY = "#0284c8";

export type DrillFrame =
  | { kind: "college"; name: string }
  | { kind: "group"; name: string }
  | { kind: "day"; date: string }
  | { kind: "intern"; internId: string; label?: string };

type InternRow = {
  internId: string;
  fullName: string;
  email: string;
  college: string | null;
  groupName: string | null;
  score: number;
  attendanceRate: number;
  taskCompletionRate: number;
  totalTasks: number;
  doneTasks: number;
  work?: {
    done: number;
    submitted: number;
    needsImprovement: number;
    assigned: number;
    recentTitles: string[];
  };
};

type RelatedAgg = {
  name: string;
  students: number;
  avgScore: number;
  avgAttendance: number;
  avgTasks: number;
};

type DetailPayload = {
  type: "college" | "group";
  name: string;
  summary: {
    count: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    totalAssignments: number;
    totalAttendanceRows: number;
  };
  charts: {
    taskStatus: Record<string, number>;
    attendanceTrend: { date: string; rate: number; present: number; total: number }[];
    internBars: { name: string; fullName: string; score: number; attendance: number; tasks: number }[];
  };
  interns: InternRow[];
  relatedGroups?: RelatedAgg[];
  relatedColleges?: RelatedAgg[];
  recentWork: {
    internId?: string;
    internName: string;
    email: string;
    title: string;
    dayNumber: number;
    taskNumber: number;
    status: string;
    forDate: string;
  }[];
};

type DayPayload = {
  date: string;
  counts: { PRESENT: number; ABSENT: number; LEAVE: number; WEEK_OFF: number };
  records: {
    id: string;
    internId: string;
    status: string;
    student: string;
    email: string;
    college: string;
    groupName: string;
    markedBy: string;
    score: number | null;
    attendanceRate: number | null;
  }[];
};

type InternDossier = {
  intern: {
    id: string;
    fullName: string;
    email: string;
    college?: { id: string; name: string } | null;
    groups: { id: string; name: string; isActiveMember: boolean }[];
    internshipStatus: string;
    isHired: boolean;
  };
  performance: {
    attendanceRate: number;
    taskCompletionRate: number;
    score: number;
    present: number;
    absent: number;
    leave: number;
    totalTasks: number;
    doneTasks: number;
  };
  attendance: {
    records: { id: string; date: string; status: string }[];
  };
  tasks: {
    records: {
      id: string;
      status: string;
      forDate: string;
      dayNumber: number;
      taskNumber: number;
      title: string;
    }[];
  };
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PRESENT: "bg-green-100 text-green-800",
    ABSENT: "bg-rose-100 text-rose-800",
    LEAVE: "bg-amber-100 text-amber-800",
    WEEK_OFF: "bg-slate-100 text-slate-600",
    DONE: "bg-green-100 text-green-800",
    SUBMITTED: "bg-sky-100 text-sky-800",
    NEEDS_IMPROVEMENT: "bg-amber-100 text-amber-800",
    ASSIGNED: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || "bg-slate-100 text-slate-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function linkBtn(label: string, onClick: () => void) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-green-800 underline-offset-2 hover:underline">
      {label}
    </button>
  );
}

type Props = {
  frame: DrillFrame;
  filterQuery: string;
  onBack: () => void;
  onOpenCollege: (name: string) => void;
  onOpenGroup: (name: string) => void;
  onOpenIntern: (internId: string, label?: string) => void;
  onOpenDay: (date: string) => void;
};

export function AnalyticsDrillPanel({
  frame,
  filterQuery,
  onBack,
  onOpenCollege,
  onOpenGroup,
  onOpenIntern,
  onOpenDay,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [dossier, setDossier] = useState<InternDossier | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    setDetail(null);
    setDay(null);
    setDossier(null);

    if (frame.kind === "college" || frame.kind === "group") {
      api
        .get(`/analytics/detail?type=${encodeURIComponent(frame.kind)}&name=${encodeURIComponent(frame.name)}`)
        .then((r) => setDetail(r.data))
        .catch(() => setError("Could not load details."))
        .finally(() => setLoading(false));
      return;
    }

    if (frame.kind === "day") {
      const qs = filterQuery ? `&${filterQuery}` : "";
      api
        .get(`/analytics/day?date=${encodeURIComponent(frame.date)}${qs}`)
        .then((r) => setDay(r.data))
        .catch(() => setError("Could not load day attendance."))
        .finally(() => setLoading(false));
      return;
    }

    api
      .get(`/attendance/report/intern/${frame.internId}?period=month&attLimit=10&taskLimit=10`)
      .then((r) => setDossier(r.data))
      .catch(() => setError("Could not load student details."))
      .finally(() => setLoading(false));
  }, [frame, filterQuery]);

  const detailBarsOption = useMemo<EChartsOption>(() => {
    const bars = detail?.charts.internBars ?? [];
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 48, right: 12, top: 36, bottom: 40 },
      xAxis: { type: "category", data: bars.map((t) => t.name), axisLabel: { rotate: bars.length > 5 ? 30 : 0 } },
      yAxis: { type: "value", max: 100 },
      series: [
        { name: "Score", type: "bar", data: bars.map((t) => t.score), itemStyle: { color: GREEN } },
        { name: "Attendance", type: "bar", data: bars.map((t) => t.attendance), itemStyle: { color: TEAL } },
        { name: "Tasks", type: "bar", data: bars.map((t) => t.tasks), itemStyle: { color: SKY } },
      ],
    };
  }, [detail?.charts.internBars]);

  const detailTaskOption = useMemo<EChartsOption>(() => {
    const ts = detail?.charts.taskStatus ?? {};
    return {
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["40%", "65%"],
          center: ["50%", "45%"],
          itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
          label: { formatter: "{b}\n{d}%" },
          data: [
            { name: "Done", value: ts.DONE ?? 0, itemStyle: { color: GREEN } },
            { name: "Submitted", value: ts.SUBMITTED ?? 0, itemStyle: { color: SKY } },
            { name: "Needs work", value: ts.NEEDS_IMPROVEMENT ?? 0, itemStyle: { color: AMBER } },
            { name: "Assigned", value: ts.ASSIGNED ?? 0, itemStyle: { color: SLATE } },
          ],
        },
      ],
    };
  }, [detail?.charts.taskStatus]);

  const detailTrendOption = useMemo<EChartsOption>(() => {
    const trend = detail?.charts.attendanceTrend ?? [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 16, top: 24, bottom: 40 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 4 }],
      xAxis: { type: "category", data: trend.map((t) => t.date.slice(5)), boundaryGap: false },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          type: "line",
          smooth: true,
          areaStyle: { color: "rgba(22,163,74,0.2)" },
          lineStyle: { color: GREEN },
          data: trend.map((t) => t.rate),
        },
      ],
    };
  }, [detail?.charts.attendanceTrend]);

  async function exportCurrent() {
    setExporting(true);
    try {
      if (frame.kind === "intern") {
        await downloadExcel(`/analytics/export?type=intern&internId=${frame.internId}`, "intern-report.xlsx");
      } else if (frame.kind === "day") {
        await downloadExcel(
          `/analytics/export?type=day&date=${encodeURIComponent(frame.date)}${filterQuery ? `&${filterQuery}` : ""}`,
          `analytics-day-${frame.date}.xlsx`,
        );
      } else {
        await downloadExcel(
          `/analytics/export?type=${frame.kind}&name=${encodeURIComponent(frame.name)}${filterQuery ? `&${filterQuery}` : ""}`,
          `analytics-${frame.kind}.xlsx`,
        );
      }
    } catch {
      setError("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const title =
    frame.kind === "college"
      ? `College: ${frame.name}`
      : frame.kind === "group"
        ? `Group: ${frame.name}`
        : frame.kind === "day"
          ? `Attendance · ${frame.date}`
          : dossier?.intern.fullName || frame.label || "Student";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-1 text-sm text-green-700 hover:underline">
            ← Back
          </button>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {detail && (
            <p className="text-sm text-slate-500">
              {detail.summary.count} students · avg score {detail.summary.avgScore}% · {detail.summary.totalAssignments}{" "}
              task assignments
            </p>
          )}
          {day && (
            <p className="text-sm text-slate-500">
              Present {day.counts.PRESENT} · Absent {day.counts.ABSENT} · Leave {day.counts.LEAVE} · Week off{" "}
              {day.counts.WEEK_OFF}
            </p>
          )}
          {dossier && (
            <p className="text-sm text-slate-500">
              Score {dossier.performance.score}% · Attendance {dossier.performance.attendanceRate}% · Tasks{" "}
              {dossier.performance.taskCompletionRate}%
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={exporting || loading}
          onClick={exportCurrent}
          className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export Excel dashboard"}
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {!loading && detail && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Students", detail.summary.count],
              ["Avg score", `${detail.summary.avgScore}%`],
              ["Avg attendance", `${detail.summary.avgAttendance}%`],
              ["Avg tasks", `${detail.summary.avgTasks}%`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Students comparison" subtitle="Click a student bar to open their profile">
              <ReactECharts
                option={detailBarsOption}
                style={{ height: 280 }}
                onEvents={{
                  click: (params: { dataIndex?: number }) => {
                    const idx = params.dataIndex;
                    if (idx == null) return;
                    const row = detail.interns[idx];
                    if (row) onOpenIntern(row.internId, row.fullName);
                  },
                }}
              />
            </ChartCard>
            <ChartCard title="Task status in this set" subtitle="Done vs pending work">
              <ReactECharts option={detailTaskOption} style={{ height: 280 }} />
            </ChartCard>
          </div>

          <ChartCard title="Attendance trend" subtitle="Click a date point to open that day's roster">
            <ReactECharts
              option={detailTrendOption}
              style={{ height: 240 }}
              onEvents={{
                click: (params: { dataIndex?: number }) => {
                  const idx = params.dataIndex;
                  if (idx == null) return;
                  const point = detail.charts.attendanceTrend[idx];
                  if (point?.date) onOpenDay(point.date.slice(0, 10));
                },
              }}
            />
          </ChartCard>

          {detail.type === "college" && (detail.relatedGroups?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">Groups in this college</p>
                <p className="text-xs text-slate-500">Click a group to open its students</p>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Group</th>
                    <th className="px-4 py-3">Students</th>
                    <th className="px-4 py-3">Avg score</th>
                    <th className="px-4 py-3">Avg attendance</th>
                    <th className="px-4 py-3">Avg tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.relatedGroups!.map((g) => (
                    <tr key={g.name} className="border-b last:border-0 hover:bg-green-50/70">
                      <td className="px-4 py-2.5">{linkBtn(g.name, () => onOpenGroup(g.name))}</td>
                      <td className="px-4 py-2.5">{g.students}</td>
                      <td className="px-4 py-2.5">{g.avgScore}%</td>
                      <td className="px-4 py-2.5">{g.avgAttendance}%</td>
                      <td className="px-4 py-2.5">{g.avgTasks}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detail.type === "group" && (detail.relatedColleges?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">Colleges in this group</p>
                <p className="text-xs text-slate-500">Click a college to open its students</p>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="px-4 py-3">College</th>
                    <th className="px-4 py-3">Students</th>
                    <th className="px-4 py-3">Avg score</th>
                    <th className="px-4 py-3">Avg attendance</th>
                    <th className="px-4 py-3">Avg tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.relatedColleges!.map((c) => (
                    <tr key={c.name} className="border-b last:border-0 hover:bg-green-50/70">
                      <td className="px-4 py-2.5">{linkBtn(c.name, () => onOpenCollege(c.name))}</td>
                      <td className="px-4 py-2.5">{c.students}</td>
                      <td className="px-4 py-2.5">{c.avgScore}%</td>
                      <td className="px-4 py-2.5">{c.avgAttendance}%</td>
                      <td className="px-4 py-2.5">{c.avgTasks}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Students in {detail.name}</p>
              <p className="text-xs text-slate-500">Click name / college / group to drill further</p>
            </div>
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">College</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Attendance</th>
                  <th className="px-4 py-3">Tasks</th>
                  <th className="px-4 py-3">Score</th>
                </tr>
              </thead>
              <tbody>
                {detail.interns.map((r, i) => (
                  <tr key={r.internId} className="border-b last:border-0 hover:bg-slate-50/80">
                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {linkBtn(r.fullName, () => onOpenIntern(r.internId, r.fullName))}
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.college ? linkBtn(r.college, () => onOpenCollege(r.college!)) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.groupName ? linkBtn(r.groupName, () => onOpenGroup(r.groupName!)) : "—"}
                    </td>
                    <td className="px-4 py-3">{r.attendanceRate}%</td>
                    <td className="px-4 py-3">
                      {r.doneTasks}/{r.totalTasks} ({r.taskCompletionRate}%)
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-700">{r.score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && day && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Present", day.counts.PRESENT, GREEN],
              ["Absent", day.counts.ABSENT, ROSE],
              ["Leave", day.counts.LEAVE, AMBER],
              ["Week off", day.counts.WEEK_OFF, SLATE],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold" style={{ color: String(color) }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Students marked on {day.date}</p>
              <p className="text-xs text-slate-500">Click student / college / group to open details</p>
            </div>
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">College</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Marked by</th>
                </tr>
              </thead>
              <tbody>
                {day.records.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/80">
                    <td className="px-4 py-2.5">
                      {linkBtn(r.student, () => onOpenIntern(r.internId, r.student))}
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </td>
                    <td className="px-4 py-2.5">{linkBtn(r.college, () => onOpenCollege(r.college))}</td>
                    <td className="px-4 py-2.5">{linkBtn(r.groupName, () => onOpenGroup(r.groupName))}</td>
                    <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                    <td className="px-4 py-2.5">{r.score != null ? `${r.score}%` : "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.markedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {day.records.length === 0 && <p className="p-4 text-sm text-slate-500">No attendance marked for this date under current filters.</p>}
          </div>
        </>
      )}

      {!loading && dossier && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <p className="text-xs uppercase text-slate-500">Email</p>
                <p className="font-medium">{dossier.intern.email}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">College</p>
                <p>
                  {dossier.intern.college?.name
                    ? linkBtn(dossier.intern.college.name, () => onOpenCollege(dossier.intern.college!.name))
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Groups</p>
                <p className="flex flex-wrap gap-2">
                  {dossier.intern.groups.length === 0 && "—"}
                  {dossier.intern.groups.map((g) => (
                    <span key={g.id}>{linkBtn(g.name, () => onOpenGroup(g.name))}</span>
                  ))}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Status</p>
                <p className="font-medium">
                  {dossier.intern.internshipStatus}
                  {dossier.intern.isHired ? " · Hired" : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Score", `${dossier.performance.score}%`],
              ["Attendance", `${dossier.performance.attendanceRate}%`],
              ["Tasks", `${dossier.performance.taskCompletionRate}%`],
              ["Done tasks", `${dossier.performance.doneTasks}/${dossier.performance.totalTasks}`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold">Recent attendance</p>
                <p className="text-xs text-slate-500">Click a date to open that day's roster</p>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.attendance.records.map((a) => {
                    const d = String(a.date).slice(0, 10);
                    return (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="px-4 py-2">{linkBtn(d, () => onOpenDay(d))}</td>
                        <td className="px-4 py-2">{statusBadge(a.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold">Recent tasks</p>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Task</th>
                    <th className="px-4 py-2">For</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.tasks.records.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        Day {t.dayNumber} · Task {t.taskNumber}: {t.title}
                      </td>
                      <td className="px-4 py-2">{String(t.forDate).slice(0, 10)}</td>
                      <td className="px-4 py-2">{statusBadge(t.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
