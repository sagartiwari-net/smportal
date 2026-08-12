import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  groupMeta?: { id: string; name: string; internshipStatus: string } | null;
  summary: {
    count: number;
    avgScore: number;
    avgAttendance: number;
    avgTasks: number;
    totalAssignments: number;
    totalAttendanceRows: number;
  };
  charts?: {
    taskStatus: Record<string, number>;
    attendanceTrend: { date: string; rate: number; present: number; total: number }[];
    internBars: { internId: string; name: string; fullName: string; score: number; attendance: number; tasks: number }[];
  };
  interns?: InternRow[];
  studentsPagination?: Pagination & { pageSize?: number };
  relatedGroups?: RelatedAgg[];
  relatedColleges?: RelatedAgg[];
  recentWork?: {
    internId?: string;
    internName: string;
    email: string;
    title: string;
    dayNumber: number;
    taskNumber: number;
    status: string;
    forDate: string;
  }[];
  workPagination?: Pagination & { pageSize?: number };
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
  attendance?: {
    records: { id: string; date: string; status: string }[];
    pagination?: { page: number; limit: number; total: number; totalPages: number };
  };
  tasks?: {
    records: {
      id: string;
      status: string;
      forDate: string;
      dayNumber: number;
      taskNumber: number;
      title: string;
      groupName?: string | null;
    }[];
    pagination?: { page: number; limit: number; total: number; totalPages: number };
  };
};

type InternTab = "overview" | "attendance" | "tasks";
type DetailTab = "overview" | "charts" | "students" | "related" | "work";

type Pagination = { page: number; limit: number; pageSize?: number; total: number; totalPages: number };

function TabPager({
  pagination,
  onChange,
}: {
  pagination: Pagination;
  onChange: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
      <span className="text-slate-500">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => onChange(pagination.page - 1)}
          className="rounded-lg border px-3 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onChange(pagination.page + 1)}
          className="rounded-lg border px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

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
  /** Show Complete / Reopen for intern dossier (Admin/HR/Trainer) */
  canManageIntern?: boolean;
  onInternUpdated?: () => void;
  /** Show Complete / Reopen for group drill-down */
  canManageGroup?: boolean;
  onGroupUpdated?: () => void;
};

export function AnalyticsDrillPanel({
  frame,
  filterQuery,
  onBack,
  onOpenCollege,
  onOpenGroup,
  onOpenIntern,
  onOpenDay,
  canManageIntern,
  onInternUpdated,
  canManageGroup,
  onGroupUpdated,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [dossier, setDossier] = useState<InternDossier | null>(null);
  const [internTab, setInternTab] = useState<InternTab>("overview");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [tabLoading, setTabLoading] = useState(false);
  const [attPage, setAttPage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [studentsPage, setStudentsPage] = useState(1);
  const [workPage, setWorkPage] = useState(1);
  const [pageLimit] = useState(20);
  const [detailPageSize] = useState(20);
  const [exporting, setExporting] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [hireNote, setHireNote] = useState("");
  /** Bumps on each frame change — stale tab fetches are ignored */
  const loadEpochRef = useRef(0);

  const internReportUrl = useCallback(
    (params: Record<string, string | number>) => {
      if (frame.kind !== "intern") return "";
      const qs = new URLSearchParams({ period: "month", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
      return `/attendance/report/intern/${frame.internId}?${qs}`;
    },
    [frame],
  );

  const detailUrl = useCallback(
    (params: Record<string, string | number>) => {
      if (frame.kind !== "college" && frame.kind !== "group") return "";
      const qs = new URLSearchParams({
        type: frame.kind,
        name: frame.name,
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      });
      const base = `/analytics/detail?${qs}`;
      return filterQuery ? `${base}&${filterQuery}` : base;
    },
    [frame, filterQuery],
  );

  async function reloadDetailSummary() {
    if (frame.kind !== "college" && frame.kind !== "group") return;
    const r = await api.get(detailUrl({ section: "summary" }));
    setDetail((prev) => ({
      ...r.data,
      charts: prev?.charts,
      interns: prev?.interns,
      studentsPagination: prev?.studentsPagination,
      relatedGroups: prev?.relatedGroups,
      relatedColleges: prev?.relatedColleges,
      recentWork: prev?.recentWork,
      workPagination: prev?.workPagination,
    }));
  }

  async function loadDetailCharts() {
    if (frame.kind !== "college" && frame.kind !== "group") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(detailUrl({ section: "charts" }));
      if (epoch !== loadEpochRef.current) return;
      // #region agent log
      fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
        body: JSON.stringify({
          sessionId: "e69c79",
          location: "AnalyticsDrillPanel.tsx:loadDetailCharts",
          message: "detail section loaded",
          data: { section: "charts", kind: frame.kind, name: frame.name },
          timestamp: Date.now(),
          hypothesisId: "H-lazy-tabs",
        }),
      }).catch(() => {});
      // #endregion
      setDetail((prev) => (prev ? { ...prev, charts: r.data.charts, summary: r.data.summary ?? prev.summary } : r.data));
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load charts.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function loadDetailStudents(page = studentsPage) {
    if (frame.kind !== "college" && frame.kind !== "group") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(detailUrl({ section: "students", page, pageSize: detailPageSize }));
      if (epoch !== loadEpochRef.current) return;
      // #region agent log
      fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
        body: JSON.stringify({
          sessionId: "e69c79",
          location: "AnalyticsDrillPanel.tsx:loadDetailStudents",
          message: "detail section loaded",
          data: { section: "students", page, count: r.data.interns?.length ?? 0 },
          timestamp: Date.now(),
          hypothesisId: "H-lazy-tabs",
        }),
      }).catch(() => {});
      // #endregion
      setDetail((prev) =>
        prev
          ? { ...prev, interns: r.data.interns, studentsPagination: r.data.studentsPagination }
          : r.data,
      );
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load students.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function loadDetailRelated() {
    if (frame.kind !== "college" && frame.kind !== "group") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(detailUrl({ section: "related" }));
      if (epoch !== loadEpochRef.current) return;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              relatedGroups: r.data.relatedGroups ?? [],
              relatedColleges: r.data.relatedColleges ?? [],
            }
          : {
              ...r.data,
              relatedGroups: r.data.relatedGroups ?? [],
              relatedColleges: r.data.relatedColleges ?? [],
            },
      );
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load related list.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function loadDetailWork(page = workPage) {
    if (frame.kind !== "college" && frame.kind !== "group") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(detailUrl({ section: "work", page, pageSize: detailPageSize }));
      if (epoch !== loadEpochRef.current) return;
      setDetail((prev) =>
        prev ? { ...prev, recentWork: r.data.recentWork, workPagination: r.data.workPagination } : r.data,
      );
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load recent work.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function reloadDossierSummary() {
    if (frame.kind !== "intern") return;
    const r = await api.get(internReportUrl({ include: "summary" }));
    setDossier((prev) => {
      const sameIntern = prev?.intern?.id === r.data.intern?.id;
      return {
        ...r.data,
        attendance: prev && sameIntern ? prev.attendance : undefined,
        tasks: prev && sameIntern ? prev.tasks : undefined,
      };
    });
  }

  async function loadAttendanceTab(page = attPage) {
    if (frame.kind !== "intern") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(internReportUrl({ include: "attendance", attPage: page, attLimit: pageLimit }));
      if (epoch !== loadEpochRef.current) return;
      setDossier((prev) =>
        prev
          ? { ...prev, attendance: r.data.attendance }
          : { intern: r.data.intern, performance: r.data.performance, attendance: r.data.attendance },
      );
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load attendance.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function loadTasksTab(page = taskPage) {
    if (frame.kind !== "intern") return;
    const epoch = loadEpochRef.current;
    setTabLoading(true);
    try {
      const r = await api.get(internReportUrl({ include: "tasks", taskPage: page, taskLimit: pageLimit }));
      if (epoch !== loadEpochRef.current) return;
      setDossier((prev) =>
        prev
          ? { ...prev, tasks: r.data.tasks }
          : { intern: r.data.intern, performance: r.data.performance, tasks: r.data.tasks },
      );
    } catch {
      if (epoch === loadEpochRef.current) setError("Could not load tasks.");
    } finally {
      if (epoch === loadEpochRef.current) setTabLoading(false);
    }
  }

  async function toggleInternComplete() {
    if (frame.kind !== "intern" || !dossier) return;
    const next = dossier.intern.internshipStatus === "COMPLETED" ? "ACTIVE" : "COMPLETED";
    const msg =
      next === "COMPLETED"
        ? `Mark ${dossier.intern.fullName}'s internship COMPLETED? (Hired status stays separate.)`
        : `Reopen ${dossier.intern.fullName}'s internship?`;
    if (!confirm(msg)) return;
    setStatusBusy(true);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
        body: JSON.stringify({
          sessionId: "e69c79",
          location: "AnalyticsDrillPanel.tsx:toggleInternComplete",
          message: "intern status patch",
          data: { internshipStatus: next, isHired: dossier.intern.isHired },
          timestamp: Date.now(),
          hypothesisId: "H-separate-hire",
        }),
      }).catch(() => {});
      // #endregion
      await api.patch(`/interns/${frame.internId}/status`, { internshipStatus: next });
      await reloadDossierSummary();
      if (internTab === "attendance") void loadAttendanceTab(attPage);
      else if (internTab === "tasks") void loadTasksTab(taskPage);
      onInternUpdated?.();
    } catch {
      setError("Could not update internship status.");
    } finally {
      setStatusBusy(false);
    }
  }

  async function toggleInternHired() {
    if (frame.kind !== "intern" || !dossier) return;
    const next = !dossier.intern.isHired;
    const msg = next
      ? `Mark ${dossier.intern.fullName} as hired? (Only this intern — not the whole group.)`
      : `Remove hired status from ${dossier.intern.fullName}?`;
    if (!confirm(msg)) return;
    setStatusBusy(true);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
        body: JSON.stringify({
          sessionId: "e69c79",
          location: "AnalyticsDrillPanel.tsx:toggleInternHired",
          message: "intern hire patch",
          data: { isHired: next, internshipStatus: dossier.intern.internshipStatus },
          timestamp: Date.now(),
          hypothesisId: "H-separate-hire",
        }),
      }).catch(() => {});
      // #endregion
      await api.patch(`/interns/${frame.internId}/status`, {
        isHired: next,
        hireNote: next ? hireNote.trim() || undefined : undefined,
      });
      await reloadDossierSummary();
      onInternUpdated?.();
    } catch {
      setError("Could not update hired status.");
    } finally {
      setStatusBusy(false);
    }
  }

  async function toggleGroupComplete() {
    if (frame.kind !== "group" || !detail?.groupMeta) return;
    const g = detail.groupMeta;
    const next = g.internshipStatus === "COMPLETED" ? "ACTIVE" : "COMPLETED";
    const msg =
      next === "COMPLETED"
        ? `Mark “${g.name}” COMPLETED? All active members will be marked completed — not hired unless you hire each one separately.`
        : `Reopen “${g.name}”?`;
    if (!confirm(msg)) return;
    setStatusBusy(true);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
        body: JSON.stringify({
          sessionId: "e69c79",
          location: "AnalyticsDrillPanel.tsx:toggleGroupComplete",
          message: "group complete patch",
          data: { groupId: g.id, internshipStatus: next },
          timestamp: Date.now(),
          hypothesisId: "H-group-complete",
        }),
      }).catch(() => {});
      // #endregion
      await api.patch(`/groups/${g.id}/complete`, { internshipStatus: next });
      await reloadDetailSummary();
      onGroupUpdated?.();
    } catch {
      setError("Could not update group status.");
    } finally {
      setStatusBusy(false);
    }
  }

  useEffect(() => {
    loadEpochRef.current += 1;
    setLoading(true);
    setError("");
    setDetail(null);
    setDay(null);
    setDossier(null);
    setInternTab("overview");
    setDetailTab("overview");
    setAttPage(1);
    setTaskPage(1);
    setStudentsPage(1);
    setWorkPage(1);
    setTabLoading(false);
    setHireNote("");

    if (frame.kind === "college" || frame.kind === "group") {
      api
        .get(detailUrl({ section: "summary" }))
        .then((r) => {
          // #region agent log
          fetch("http://127.0.0.1:7300/ingest/eabdbff4-910b-4e9a-93be-a8f89536775f", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e69c79" },
            body: JSON.stringify({
              sessionId: "e69c79",
              location: "AnalyticsDrillPanel.tsx:useEffect",
              message: "detail summary loaded",
              data: { kind: frame.kind, name: frame.name, count: r.data.summary?.count },
              timestamp: Date.now(),
              hypothesisId: "H-lazy-tabs",
            }),
          }).catch(() => {});
          // #endregion
          setDetail(r.data);
        })
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
      .get(`/attendance/report/intern/${frame.internId}?period=month&include=summary`)
      .then((r) => setDossier(r.data))
      .catch(() => setError("Could not load student details."))
      .finally(() => setLoading(false));
  }, [frame, filterQuery, detailUrl]);

  useEffect(() => {
    if (frame.kind !== "intern" || loading || !dossier) return;
    if (internTab === "attendance") void loadAttendanceTab(attPage);
    if (internTab === "tasks") void loadTasksTab(taskPage);
  }, [frame.kind, internTab, attPage, taskPage, loading, dossier?.intern.id]);

  useEffect(() => {
    if ((frame.kind !== "college" && frame.kind !== "group") || loading || !detail) return;
    if (detailTab === "charts" && !detail.charts) void loadDetailCharts();
    if (detailTab === "students" && !detail.interns) void loadDetailStudents(studentsPage);
    if (detailTab === "related" && detail.relatedGroups === undefined && detail.relatedColleges === undefined) {
      void loadDetailRelated();
    }
    if (detailTab === "work" && !detail.recentWork) void loadDetailWork(workPage);
  }, [frame.kind, detailTab, studentsPage, workPage, loading, detail?.name]);

  useEffect(() => {
    if ((frame.kind !== "college" && frame.kind !== "group") || detailTab !== "students" || !detail?.interns) return;
    void loadDetailStudents(studentsPage);
  }, [studentsPage]);

  useEffect(() => {
    if ((frame.kind !== "college" && frame.kind !== "group") || detailTab !== "work" || !detail?.recentWork) return;
    void loadDetailWork(workPage);
  }, [workPage]);

  const detailBarsOption = useMemo<EChartsOption>(() => {
    const bars = detail?.charts?.internBars ?? [];
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
  }, [detail?.charts?.internBars]);

  const detailTaskOption = useMemo<EChartsOption>(() => {
    const ts = detail?.charts?.taskStatus ?? {};
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
  }, [detail?.charts?.taskStatus]);

  const detailTrendOption = useMemo<EChartsOption>(() => {
    const trend = detail?.charts?.attendanceTrend ?? [];
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
  }, [detail?.charts?.attendanceTrend]);

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
              {detail.summary.count} students · avg score {detail.summary.avgScore}%
              {detail.summary.totalAssignments != null ? ` · ${detail.summary.totalAssignments} task assignments` : ""}
              {detail.groupMeta?.internshipStatus === "COMPLETED" ? " · Group completed" : ""}
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
        <div className="flex flex-wrap items-center gap-2">
          {canManageGroup && frame.kind === "group" && detail?.groupMeta && (
            <button
              type="button"
              disabled={statusBusy || loading}
              onClick={() => void toggleGroupComplete()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {detail.groupMeta.internshipStatus === "COMPLETED" ? "Reopen group" : "Mark group complete"}
            </button>
          )}
          {canManageIntern && frame.kind === "intern" && dossier && (
            <>
              <button
                type="button"
                disabled={statusBusy || loading}
                onClick={() => void toggleInternComplete()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {dossier.intern.internshipStatus === "COMPLETED" ? "Reopen internship" : "Mark internship complete"}
              </button>
              <button
                type="button"
                disabled={statusBusy || loading}
                onClick={() => void toggleInternHired()}
                className="rounded-lg border border-sky-300 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50"
              >
                {dossier.intern.isHired ? "Remove hired" : "Mark as hired"}
              </button>
            </>
          )}
          <button
            type="button"
            disabled={exporting || loading}
            onClick={exportCurrent}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export Excel dashboard"}
          </button>
        </div>
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

          {detail.groupMeta?.internshipStatus === "COMPLETED" && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Group internship completed — members are marked completed but not auto-hired. Hire each intern individually if needed.
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap gap-1 border-b bg-slate-50 p-2">
              {(
                [
                  ["overview", "Overview"],
                  ["charts", "Charts"],
                  ["students", `Students (${detail.summary.count})`],
                  ["related", detail.type === "college" ? "Groups" : "Colleges"],
                  ["work", "Recent work"],
                ] as [DetailTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDetailTab(id)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    detailTab === id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tabLoading && detailTab !== "overview" && (
              <p className="p-4 text-sm text-slate-500">Loading {detailTab}…</p>
            )}

            {detailTab === "overview" && (
              <div className="p-4 text-sm text-slate-600">
                <p>
                  Open <strong>Charts</strong>, <strong>Students</strong>, <strong>{detail.type === "college" ? "Groups" : "Colleges"}</strong>, or{" "}
                  <strong>Recent work</strong> tabs to load details on demand — faster when data grows large.
                </p>
              </div>
            )}

            {detailTab === "charts" && !tabLoading && detail.charts && (
              <div className="space-y-4 p-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard title="Students comparison" subtitle="Click a student bar to open their profile">
                    <ReactECharts
                      option={detailBarsOption}
                      style={{ height: 280 }}
                      onEvents={{
                        click: (params: { dataIndex?: number }) => {
                          const idx = params.dataIndex;
                          if (idx == null) return;
                          const bar = detail.charts!.internBars[idx];
                          if (bar?.internId) onOpenIntern(bar.internId, bar.fullName);
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
                        const point = detail.charts!.attendanceTrend[idx];
                        if (point?.date) onOpenDay(point.date.slice(0, 10));
                      },
                    }}
                  />
                </ChartCard>
              </div>
            )}

            {detailTab === "students" && !tabLoading && detail.interns && (
              <>
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
                        <td className="px-4 py-3 text-slate-400">
                          {((detail.studentsPagination?.page ?? 1) - 1) * (detail.studentsPagination?.pageSize ?? detailPageSize) + i + 1}
                        </td>
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
                {detail.interns.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">No students in this {detail.type}.</p>
                )}
                {detail.studentsPagination && (
                  <TabPager
                    pagination={{
                      page: detail.studentsPagination.page,
                      limit: detail.studentsPagination.pageSize ?? detail.studentsPagination.limit ?? detailPageSize,
                      total: detail.studentsPagination.total,
                      totalPages: detail.studentsPagination.totalPages,
                    }}
                    onChange={setStudentsPage}
                  />
                )}
              </>
            )}

            {detailTab === "related" && !tabLoading && (
              <>
                {detail.type === "college" && (detail.relatedGroups?.length ?? 0) > 0 && (
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
                )}
                {detail.type === "group" && (detail.relatedColleges?.length ?? 0) > 0 && (
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
                )}
                {((detail.type === "college" && !(detail.relatedGroups?.length ?? 0)) ||
                  (detail.type === "group" && !(detail.relatedColleges?.length ?? 0))) && (
                  <p className="p-4 text-sm text-slate-500">No related {detail.type === "college" ? "groups" : "colleges"} found.</p>
                )}
              </>
            )}

            {detailTab === "work" && !tabLoading && detail.recentWork && (
              <>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Task</th>
                      <th className="px-4 py-3">For date</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentWork.map((w, i) => (
                      <tr key={`${w.internId}-${w.forDate}-${i}`} className="border-b last:border-0 hover:bg-slate-50/80">
                        <td className="px-4 py-3">
                          {w.internId
                            ? linkBtn(w.internName, () => onOpenIntern(w.internId!, w.internName))
                            : w.internName}
                          <div className="text-xs text-slate-400">{w.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          Day {w.dayNumber} · Task {w.taskNumber}: {w.title}
                        </td>
                        <td className="px-4 py-3">{String(w.forDate).slice(0, 10)}</td>
                        <td className="px-4 py-3">{statusBadge(w.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.recentWork.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">No task assignments yet.</p>
                )}
                {detail.workPagination && (
                  <TabPager
                    pagination={{
                      page: detail.workPagination.page,
                      limit: detail.workPagination.pageSize ?? detail.workPagination.limit ?? detailPageSize,
                      total: detail.workPagination.total,
                      totalPages: detail.workPagination.totalPages,
                    }}
                    onChange={setWorkPage}
                  />
                )}
              </>
            )}
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
                <p className="text-xs uppercase text-slate-500">Internship</p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    dossier.intern.internshipStatus === "COMPLETED"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-green-100 text-green-800"
                  }`}
                >
                  {dossier.intern.internshipStatus}
                </span>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Hired</p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    dossier.intern.isHired ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {dossier.intern.isHired ? "Yes" : "No"}
                </span>
              </div>
            </div>
            {canManageIntern && !dossier.intern.isHired && (
              <div className="mt-3 border-t pt-3">
                <label className="text-xs text-slate-500">Optional hire note (used when you mark as hired)</label>
                <input
                  className="mt-1 w-full max-w-md rounded-lg border px-3 py-2 text-sm"
                  placeholder="e.g. Full-time offer · role"
                  value={hireNote}
                  onChange={(e) => setHireNote(e.target.value)}
                />
              </div>
            )}
          </div>

          {dossier.intern.internshipStatus === "COMPLETED" && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Internship completed — attendance, tasks, and scores below stay available for full history review.
            </div>
          )}

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

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap gap-1 border-b bg-slate-50 p-2">
              {(
                [
                  ["overview", "Overview"],
                  ["attendance", `Attendance (${dossier.performance.present + dossier.performance.absent + dossier.performance.leave})`],
                  ["tasks", `Tasks (${dossier.performance.totalTasks})`],
                ] as [InternTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setInternTab(id)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    internTab === id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tabLoading && internTab !== "overview" && (
              <p className="p-4 text-sm text-slate-500">Loading {internTab}…</p>
            )}

            {internTab === "overview" && (
              <div className="p-4 text-sm text-slate-600">
                <p>
                  Open <strong>Attendance</strong> or <strong>Tasks</strong> tabs to load detailed records on demand —
                  faster when data grows large.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs uppercase text-slate-500">Present days</p>
                    <p className="text-xl font-bold text-green-700">{dossier.performance.present}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs uppercase text-slate-500">Absent days</p>
                    <p className="text-xl font-bold text-rose-700">{dossier.performance.absent}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs uppercase text-slate-500">Leave days</p>
                    <p className="text-xl font-bold text-amber-700">{dossier.performance.leave}</p>
                  </div>
                </div>
              </div>
            )}

            {internTab === "attendance" && !tabLoading && dossier.attendance && (
              <>
                <div className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
                  Click a date to open that day&apos;s roster
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
                {dossier.attendance.records.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">No attendance records in this period.</p>
                )}
                {dossier.attendance.pagination && (
                  <TabPager pagination={dossier.attendance.pagination} onChange={setAttPage} />
                )}
              </>
            )}

            {internTab === "tasks" && !tabLoading && dossier.tasks && (
              <>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Task</th>
                      <th className="px-4 py-2">For</th>
                      <th className="px-4 py-2">Group</th>
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
                        <td className="px-4 py-2 text-slate-600">{t.groupName || "—"}</td>
                        <td className="px-4 py-2">{statusBadge(t.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dossier.tasks.records.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">No tasks found.</p>
                )}
                {dossier.tasks.pagination && (
                  <TabPager pagination={dossier.tasks.pagination} onChange={setTaskPage} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
