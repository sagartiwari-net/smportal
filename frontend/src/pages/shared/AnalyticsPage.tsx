import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { api } from "../../api/client";
import { PageHeader } from "../../components/ui/PageHeader";

type TabId = "overview" | "tasks" | "attendance" | "colleges" | "leaderboard";

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
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

type TabPayload = {
  tab: TabId;
  filters: { collegeOptions: string[]; groupOptions: string[] };
  summary: {
    count: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    totalAssignments: number;
    totalAttendanceRows: number;
  };
  interns?: InternRow[];
  pagination?: Pagination;
  table?: {
    rows: { date: string; rate: number; present: number; absent: number; leave: number; total: number }[];
    pagination: Pagination;
  };
  charts?: {
    taskStatus?: Record<string, number>;
    attendanceTrend?: { date: string; rate: number; present: number; absent: number; leave: number; total: number }[];
    byCollege?: { name: string; count: number; avgScore: number; avgAttendance: number; avgTasks: number }[];
    byGroup?: { name: string; count: number; avgScore: number; tasksDone: number; tasksTotal: number }[];
    topInterns?: { name: string; fullName: string; score: number; attendance: number; tasks: number }[];
  };
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
  interns: (InternRow & {
    work: {
      done: number;
      submitted: number;
      needsImprovement: number;
      assigned: number;
      recentTitles: string[];
    };
  })[];
  recentWork: {
    internName: string;
    email: string;
    title: string;
    dayNumber: number;
    taskNumber: number;
    status: string;
    forDate: string;
  }[];
};

type FilterState = {
  college: string;
  group: string;
  search: string;
  minScore: string;
  maxScore: string;
  minAttendance: string;
  maxAttendance: string;
  minTasks: string;
  maxTasks: string;
  from: string;
  to: string;
  sort: string;
};

const EMPTY_FILTERS: FilterState = {
  college: "all",
  group: "all",
  search: "",
  minScore: "",
  maxScore: "",
  minAttendance: "",
  maxAttendance: "",
  minTasks: "",
  maxTasks: "",
  from: "",
  to: "",
  sort: "score_desc",
};

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "attendance", label: "Attendance" },
  { id: "colleges", label: "College & Group" },
  { id: "leaderboard", label: "Leaderboard" },
];

const GREEN = "#16a34a";
const TEAL = "#0d9488";
const AMBER = "#d97706";
const ROSE = "#e11d48";
const SLATE = "#64748b";
const SKY = "#0284c8";
const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-green-500";

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
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

function DataTable({
  title,
  subtitle,
  headers,
  rows,
}: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <table className="min-w-full text-left text-sm">
        <thead className="border-b text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-slate-50/80">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No rows for current filters.</p>}
    </div>
  );
}

function Pager({
  pagination,
  onChange,
}: {
  pagination: Pagination;
  onChange: (page: number) => void;
}) {
  const { page, totalPages, total, pageSize } = pagination;
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <p>
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
        >
          Previous
        </button>
        <span className="tabular-nums">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ClickableTable({
  title,
  subtitle,
  headers,
  rows,
  onRowClick,
}: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: { key: string; cells: (string | number)[]; hint?: string }[];
  onRowClick: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <table className="min-w-full text-left text-sm">
        <thead className="border-b text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              onClick={() => onRowClick(row.key)}
              title={row.hint || "Click for details"}
              className="cursor-pointer border-b last:border-0 hover:bg-green-50/70"
            >
              {row.cells.map((cell, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? "font-medium text-green-800 underline-offset-2 hover:underline" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No rows for current filters.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function buildQuery(f: FilterState, tab: TabId, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (f.college && f.college !== "all") params.set("college", f.college);
  if (f.group && f.group !== "all") params.set("group", f.group);
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.minScore !== "") params.set("minScore", f.minScore);
  if (f.maxScore !== "") params.set("maxScore", f.maxScore);
  if (f.minAttendance !== "") params.set("minAttendance", f.minAttendance);
  if (f.maxAttendance !== "") params.set("maxAttendance", f.maxAttendance);
  if (f.minTasks !== "") params.set("minTasks", f.minTasks);
  if (f.maxTasks !== "") params.set("maxTasks", f.maxTasks);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.sort) params.set("sort", f.sort);
  return params.toString();
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [data, setData] = useState<TabPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<{ collegeOptions: string[]; groupOptions: string[] }>({
    collegeOptions: [],
    groupOptions: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    api
      .get("/analytics/filter-options")
      .then((r) => setFilterOptions(r.data))
      .catch(() => {});
  }, []);

  const loadTab = useCallback(
    (t: TabId, f: FilterState, p: number) => {
      setLoading(true);
      setError("");
      const qs = buildQuery(f, t, p, pageSize);
      api
        .get(`/analytics/dashboard?${qs}`)
        .then((r) => {
          setData(r.data);
          if (r.data.filters?.collegeOptions?.length) {
            setFilterOptions({
              collegeOptions: r.data.filters.collegeOptions,
              groupOptions: r.data.filters.groupOptions,
            });
          }
        })
        .catch(() => setError("Could not load this report tab."))
        .finally(() => setLoading(false));
    },
    [pageSize],
  );

  useEffect(() => {
    if (detail) return; // pause tab reload while drilling down
    loadTab(tab, applied, page);
  }, [tab, applied, page, loadTab, detail]);

  function switchTab(next: TabId) {
    setDetail(null);
    setTab(next);
    setPage(1);
  }

  function openDetail(type: "college" | "group", name: string) {
    setDetailLoading(true);
    setDetailError("");
    api
      .get(`/analytics/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`)
      .then((r) => setDetail(r.data))
      .catch(() => setDetailError("Could not load details."))
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setDetail(null);
    setDetailError("");
  }

  function applyFilters(e?: FormEvent) {
    e?.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  function exportCsv() {
    if (tab !== "leaderboard") {
      // fetch full leaderboard once for export
      const qs = buildQuery(applied, "leaderboard", 1, 500);
      api.get(`/analytics/dashboard?${qs}`).then((r) => {
        downloadCsv(r.data.interns || []);
      });
      return;
    }
    downloadCsv(data?.interns || []);
  }

  function downloadCsv(rows: InternRow[]) {
    const header = ["Name", "Email", "College", "Group", "Score", "Attendance%", "Tasks%"];
    const lines = rows.map((r) =>
      [r.fullName, r.email, r.college || "", r.groupName || "", r.score, r.attendanceRate, r.taskCompletionRate]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "performance-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = data?.summary;
  const charts = data?.charts;

  const gaugeOption = useMemo<EChartsOption>(
    () => ({
      series: [
        {
          type: "gauge",
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max: 100,
          radius: "100%",
          center: ["50%", "58%"],
          axisLine: {
            lineStyle: {
              width: 18,
              color: [
                [0.4, ROSE],
                [0.7, AMBER],
                [1, GREEN],
              ],
            },
          },
          pointer: { itemStyle: { color: "#0f172a" }, width: 5, length: "60%" },
          detail: {
            formatter: "{value}%",
            fontSize: 22,
            fontWeight: 700,
            offsetCenter: [0, "72%"],
          },
          data: [{ value: summary?.avgScore ?? 0, name: "Avg score" }],
          title: { offsetCenter: [0, "92%"], color: SLATE, fontSize: 12 },
        },
      ],
    }),
    [summary?.avgScore],
  );

  const taskDonutOption = useMemo<EChartsOption>(() => {
    const ts = charts?.taskStatus ?? {};
    return {
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
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
  }, [charts?.taskStatus]);

  const trendOption = useMemo<EChartsOption>(() => {
    const trend = charts?.attendanceTrend ?? [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 16, top: 28, bottom: 56 },
      dataZoom: [
        { type: "inside", start: Math.max(0, 100 - (12 / Math.max(trend.length, 1)) * 100), end: 100 },
        { type: "slider", height: 18, bottom: 8 },
      ],
      xAxis: { type: "category", data: trend.map((t) => t.date.slice(5)), boundaryGap: false },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "Attendance %",
          type: "line",
          smooth: true,
          areaStyle: { color: "rgba(22,163,74,0.2)" },
          lineStyle: { color: GREEN, width: 2.5 },
          data: trend.map((t) => t.rate),
        },
      ],
    };
  }, [charts?.attendanceTrend]);

  const topBarOption = useMemo<EChartsOption>(() => {
    const top = charts?.topInterns ?? [];
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 48, right: 12, top: 36, bottom: 28 },
      xAxis: { type: "category", data: top.map((t) => t.name), axisLabel: { rotate: top.length > 6 ? 30 : 0 } },
      yAxis: { type: "value", max: 100 },
      series: [
        { name: "Score", type: "bar", data: top.map((t) => t.score), itemStyle: { color: GREEN } },
        { name: "Attendance", type: "bar", data: top.map((t) => t.attendance), itemStyle: { color: TEAL } },
        { name: "Tasks", type: "bar", data: top.map((t) => t.tasks), itemStyle: { color: SKY } },
      ],
    };
  }, [charts?.topInterns]);

  const collegeOption = useMemo<EChartsOption>(() => {
    const cols = charts?.byCollege ?? [];
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 110, right: 20, top: 36, bottom: 24 },
      xAxis: { type: "value", max: 100 },
      yAxis: { type: "category", data: cols.map((c) => c.name) },
      series: [
        { name: "Score", type: "bar", data: cols.map((c) => c.avgScore), itemStyle: { color: GREEN } },
        { name: "Attendance", type: "bar", data: cols.map((c) => c.avgAttendance), itemStyle: { color: TEAL } },
        { name: "Tasks", type: "bar", data: cols.map((c) => c.avgTasks), itemStyle: { color: SKY } },
      ],
    };
  }, [charts?.byCollege]);

  const groupOption = useMemo<EChartsOption>(() => {
    const groups = charts?.byGroup ?? [];
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 40 },
      xAxis: { type: "category", data: groups.map((g) => g.name), axisLabel: { rotate: 15 } },
      yAxis: [
        { type: "value", max: 100 },
        { type: "value", splitLine: { show: false } },
      ],
      series: [
        { name: "Avg score", type: "bar", data: groups.map((g) => g.avgScore), itemStyle: { color: GREEN } },
        { name: "Tasks done", type: "line", yAxisIndex: 1, data: groups.map((g) => g.tasksDone), itemStyle: { color: AMBER } },
      ],
    };
  }, [charts?.byGroup]);

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

  const taskStatusRows = useMemo(() => {
    const ts = charts?.taskStatus ?? {};
    const total = (ts.DONE ?? 0) + (ts.SUBMITTED ?? 0) + (ts.NEEDS_IMPROVEMENT ?? 0) + (ts.ASSIGNED ?? 0);
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return [
      ["Done", ts.DONE ?? 0, `${pct(ts.DONE ?? 0)}%`],
      ["Submitted", ts.SUBMITTED ?? 0, `${pct(ts.SUBMITTED ?? 0)}%`],
      ["Needs work", ts.NEEDS_IMPROVEMENT ?? 0, `${pct(ts.NEEDS_IMPROVEMENT ?? 0)}%`],
      ["Assigned", ts.ASSIGNED ?? 0, `${pct(ts.ASSIGNED ?? 0)}%`],
      ["Total", total, "100%"],
    ];
  }, [charts?.taskStatus]);

  const collegeOptions = filterOptions.collegeOptions;
  const groupOptions = filterOptions.groupOptions;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Performance Analytics"
          subtitle="Tabs load on demand · score = 0.5×attendance + 0.5×task completion"
        />
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={exportCsv} className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            Export CSV
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700">
            Print report
          </button>
        </div>
      </div>

      <form onSubmit={applyFilters} className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Filters</h3>
          <div className="flex gap-2">
            <button type="button" onClick={resetFilters} className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Reset
            </button>
            <button type="submit" className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700">
              Apply filters
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="College">
            <select className={inputCls} value={filters.college} onChange={(e) => setFilters({ ...filters, college: e.target.value })}>
              <option value="all">All colleges</option>
              {collegeOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Group">
            <select className={inputCls} value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
              <option value="all">All groups</option>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search name / email">
            <input className={inputCls} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Type to search…" />
          </Field>
          <Field label="Sort by">
            <select className={inputCls} value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
              <option value="score_desc">Score (high → low)</option>
              <option value="score_asc">Score (low → high)</option>
              <option value="attendance_desc">Attendance (high → low)</option>
              <option value="attendance_asc">Attendance (low → high)</option>
              <option value="tasks_desc">Tasks % (high → low)</option>
              <option value="tasks_asc">Tasks % (low → high)</option>
              <option value="name_asc">Name (A → Z)</option>
              <option value="name_desc">Name (Z → A)</option>
            </select>
          </Field>
          <Field label="Date from">
            <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </Field>
          <Field label="Date to">
            <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </Field>
          <Field label="Min score %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })} />
          </Field>
          <Field label="Max score %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.maxScore} onChange={(e) => setFilters({ ...filters, maxScore: e.target.value })} />
          </Field>
          <Field label="Min attendance %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.minAttendance} onChange={(e) => setFilters({ ...filters, minAttendance: e.target.value })} />
          </Field>
          <Field label="Max attendance %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.maxAttendance} onChange={(e) => setFilters({ ...filters, maxAttendance: e.target.value })} />
          </Field>
          <Field label="Min tasks %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.minTasks} onChange={(e) => setFilters({ ...filters, minTasks: e.target.value })} />
          </Field>
          <Field label="Max tasks %">
            <input type="number" min={0} max={100} className={inputCls} value={filters.maxTasks} onChange={(e) => setFilters({ ...filters, maxTasks: e.target.value })} />
          </Field>
        </div>
      </form>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm print:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {loading && <p className="mb-3 text-xs text-slate-400">Loading {TABS.find((t) => t.id === tab)?.label}…</p>}

      {summary && !detail && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Students", summary.count],
            ["Avg score", `${summary.avgScore}%`],
            ["Avg attendance", `${summary.avgAttendance}%`],
            ["Avg tasks", `${summary.avgTasks}%`],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {!loading && data && tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Overall performance score" subtitle="Filtered average score">
            <ReactECharts option={gaugeOption} style={{ height: 260 }} />
          </ChartCard>
          <ChartCard title="Top interns comparison" subtitle="Score · attendance · tasks">
            <ReactECharts option={topBarOption} style={{ height: 260 }} />
          </ChartCard>
        </div>
      )}

      {!loading && data && tab === "tasks" && (
        <div className="space-y-6">
          <ChartCard title="Task status breakdown" subtitle="Done / Submitted / Needs work / Assigned">
            <ReactECharts option={taskDonutOption} style={{ height: 280 }} />
          </ChartCard>
          <DataTable title="Table · Task status" subtitle="Counts under current filters" headers={["Status", "Count", "Share"]} rows={taskStatusRows} />
        </div>
      )}

      {!loading && data && tab === "attendance" && (
        <div className="space-y-6">
          <ChartCard title="Daily attendance trend" subtitle="Present % by date — drag slider to zoom">
            <ReactECharts option={trendOption} style={{ height: 280 }} />
          </ChartCard>
          <div>
            <DataTable
              title="Table · Daily attendance"
              subtitle="Paginated day-wise present / absent / leave"
              headers={["Date", "Present", "Absent", "Leave", "Counted", "Present %"]}
              rows={(data.table?.rows ?? []).map((t) => [t.date, t.present, t.absent, t.leave, t.total, `${t.rate}%`])}
            />
            {data.table?.pagination && <Pager pagination={data.table.pagination} onChange={setPage} />}
          </div>
        </div>
      )}

      {!loading && data && tab === "colleges" && !detail && !detailLoading && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500">
            Tip: table row ya chart pe click karke us college / group ka student list + work details dekho.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="College-wise performance" subtitle="Click a college bar to open details">
              <ReactECharts
                option={collegeOption}
                style={{ height: 260 }}
                onEvents={{
                  click: (params: { name?: string }) => {
                    if (params.name) openDetail("college", params.name);
                  },
                }}
              />
            </ChartCard>
            <ChartCard title="Group-wise score vs tasks done" subtitle="Click a group name/bar to open details">
              <ReactECharts
                option={groupOption}
                style={{ height: 260 }}
                onEvents={{
                  click: (params: { name?: string }) => {
                    if (params.name) openDetail("group", params.name);
                  },
                }}
              />
            </ChartCard>
          </div>
          <ClickableTable
            title="Table · College-wise"
            subtitle="Click a college to see how many students and what they are working on"
            headers={["College", "Interns", "Avg score", "Avg attendance", "Avg tasks"]}
            rows={(charts?.byCollege ?? []).map((c) => ({
              key: c.name,
              cells: [c.name, c.count, `${c.avgScore}%`, `${c.avgAttendance}%`, `${c.avgTasks}%`],
              hint: `Open ${c.name} details`,
            }))}
            onRowClick={(name) => openDetail("college", name)}
          />
          <ClickableTable
            title="Table · Group-wise"
            subtitle="Click a group to see members and their task progress"
            headers={["Group", "Interns", "Avg score", "Tasks done", "Tasks total"]}
            rows={(charts?.byGroup ?? []).map((g) => ({
              key: g.name,
              cells: [g.name, g.count, `${g.avgScore}%`, g.tasksDone, g.tasksTotal],
              hint: `Open ${g.name} details`,
            }))}
            onRowClick={(name) => openDetail("group", name)}
          />
        </div>
      )}

      {(detailLoading || detailError) && tab === "colleges" && (
        <div className="mb-4">
          {detailLoading && <p className="text-sm text-slate-500">Loading details…</p>}
          {detailError && <p className="text-sm text-rose-600">{detailError}</p>}
        </div>
      )}

      {detail && tab === "colleges" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button type="button" onClick={closeDetail} className="mb-1 text-sm text-green-700 hover:underline">
                ← Back to College & Group
              </button>
              <h2 className="text-lg font-semibold text-slate-900">
                {detail.type === "college" ? "College" : "Group"}: {detail.name}
              </h2>
              <p className="text-sm text-slate-500">
                {detail.summary.count} students · avg score {detail.summary.avgScore}% · {detail.summary.totalAssignments}{" "}
                task assignments
              </p>
            </div>
          </div>

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
            <ChartCard title="Students comparison" subtitle="Score · attendance · task completion for each student">
              <ReactECharts option={detailBarsOption} style={{ height: 280 }} />
            </ChartCard>
            <ChartCard title="Task status in this set" subtitle="What work is done vs pending">
              <ReactECharts option={detailTaskOption} style={{ height: 280 }} />
            </ChartCard>
          </div>

          <ChartCard title="Attendance trend" subtitle="Present % over time for these students">
            <ReactECharts option={detailTrendOption} style={{ height: 240 }} />
          </ChartCard>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Students in {detail.name}</p>
              <p className="text-xs text-slate-500">Performance + current work snapshot</p>
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
                  <th className="px-4 py-3">Work status</th>
                </tr>
              </thead>
              <tbody>
                {detail.interns.map((r, i) => (
                  <tr key={r.internId} className="border-b align-top last:border-0">
                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.fullName}</div>
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </td>
                    <td className="px-4 py-3">{r.college || "—"}</td>
                    <td className="px-4 py-3">{r.groupName || "—"}</td>
                    <td className="px-4 py-3">{r.attendanceRate}%</td>
                    <td className="px-4 py-3">
                      {r.doneTasks}/{r.totalTasks} ({r.taskCompletionRate}%)
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-700">{r.score}%</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>
                        Done {r.work.done} · Submitted {r.work.submitted} · Needs {r.work.needsImprovement} · Assigned{" "}
                        {r.work.assigned}
                      </p>
                      {r.work.recentTitles.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-slate-500">
                          {r.work.recentTitles.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DataTable
            title="Recent work across students"
            subtitle="Latest task assignments and status"
            headers={["Intern", "Task", "Day/Task", "Status", "For date"]}
            rows={detail.recentWork.map((w) => [
              w.internName,
              w.title,
              `Day ${w.dayNumber} · Task ${w.taskNumber}`,
              w.status,
              String(w.forDate).slice(0, 10),
            ])}
          />
        </div>
      )}

      {!loading && data && tab === "leaderboard" && (
        <div>
          <div className="mb-4 print:hidden">
            <ChartCard title="Top 10 preview" subtitle="Under current sort / filters">
              <ReactECharts option={topBarOption} style={{ height: 240 }} />
            </ChartCard>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Intern leaderboard</p>
              <p className="text-xs text-slate-500">Paginated list — change page below</p>
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
                {(data.interns ?? []).map((r, i) => {
                  const rank = ((data.pagination?.page ?? 1) - 1) * (data.pagination?.pageSize ?? 10) + i + 1;
                  return (
                    <tr key={r.internId} className="border-b last:border-0 hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-slate-400">{rank}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.fullName}</div>
                        <div className="text-xs text-slate-400">{r.email}</div>
                      </td>
                      <td className="px-4 py-3">{r.college || "—"}</td>
                      <td className="px-4 py-3">{r.groupName || "—"}</td>
                      <td className="px-4 py-3">{r.attendanceRate}%</td>
                      <td className="px-4 py-3">
                        {r.doneTasks}/{r.totalTasks} ({r.taskCompletionRate}%)
                      </td>
                      <td className="px-4 py-3 font-semibold text-green-700">{r.score}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(data.interns ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">No interns match these filters.</p>}
          </div>
          {data.pagination && <Pager pagination={data.pagination} onChange={setPage} />}
        </div>
      )}
    </div>
  );
}
