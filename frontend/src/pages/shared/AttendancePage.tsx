import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../api/client";
import { downloadExcel } from "../../api/downloadExcel";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type GroupOpt = {
  id: string;
  name: string;
  internshipStatus?: string;
  members: { internId: string; intern: { user: { fullName: string } } }[];
};

type DaySummary = {
  date: string;
  present: number;
  absent: number;
  leave: number;
  weekOff: number;
  total: number;
  isWeekOffDay: boolean;
  markedBy: { id: string; fullName: string; role: string }[];
};

type DayRecord = {
  id: string;
  status: string;
  groupName?: string;
  collegeName?: string | null;
  markedByName?: string | null;
  markedByRole?: string | null;
  intern?: { id: string; user: { fullName: string; email?: string } };
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type InternDossier = {
  intern: {
    id: string;
    fullName: string;
    email: string;
    phone?: string | null;
    college?: { id: string; name: string } | null;
    joinedAt: string;
    internshipStatus: string;
    completedAt?: string | null;
    completedBy?: { fullName: string; role: string } | null;
    isHired: boolean;
    hiredAt?: string | null;
    hiredBy?: { fullName: string; role: string } | null;
    hireNote?: string | null;
    groups: {
      id: string;
      name: string;
      batchLabel?: string | null;
      internshipStatus: string;
      isActiveMember: boolean;
    }[];
    pastGroups?: {
      id: string;
      name: string;
      batchLabel?: string | null;
      leftAt?: string | null;
    }[];
  };
  periodOptions?: { value: string; label: string }[];
  selectedPeriod?: string;
  performance: {
    attendanceRate: number;
    taskCompletionRate: number;
    score: number;
    present: number;
    absent: number;
    leave: number;
    totalTasks: number;
    doneTasks: number;
    submittedTasks: number;
    needsImprovement: number;
  };
  attendance: {
    period: string;
    records: { id: string; date: string; status: string; markedBy?: { fullName: string; role: string } | null }[];
    pagination: Pagination;
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
    pagination: Pagination;
    statusFilter?: string;
  };
};

const PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

const PAGE_SIZES = [10, 20, 30] as const;

const TASK_STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs improvement" },
  { value: "DONE", label: "Done" },
];

function Pager({
  pagination,
  onChange,
}: {
  pagination: Pagination;
  onChange: (page: number) => void;
}) {
  const { page, totalPages, total, limit } = pagination;
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
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

function PageSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
      Per page
      <select
        className="rounded-lg border px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function roleLabel(role?: string | null) {
  if (!role) return "";
  if (role === "TRAINER") return "Trainer";
  if (role === "HR") return "HR";
  if (role === "ADMIN") return "Admin";
  return role;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function AttendancePage() {
  const { user } = useAuth();
  const canMark = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const isIntern = user?.role === "INTERN";
  const canManageStatus = canMark;

  const [staffTab, setStaffTab] = useState<"mark" | "report">("report");
  const [view, setView] = useState<"list" | "day" | "intern">("list");
  const [internSubTab, setInternSubTab] = useState<"overview" | "attendance" | "tasks" | "status">("overview");

  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const todayStr = useMemo(() => todayYmd(), []);
  const [date, setDate] = useState(todayStr);
  const [groupId, setGroupId] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [markMsg, setMarkMsg] = useState("");
  const [markErr, setMarkErr] = useState("");

  const [period, setPeriod] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [reportGroupId, setReportGroupId] = useState("all");
  const [days, setDays] = useState<DaySummary[]>([]);
  const [rangeMeta, setRangeMeta] = useState<{ from?: string; to?: string }>({});
  const [loading, setLoading] = useState(false);

  const [selectedDate, setSelectedDate] = useState("");
  const [dayGroupId, setDayGroupId] = useState("all");
  const [dayRecords, setDayRecords] = useState<DayRecord[]>([]);
  const [dayCounts, setDayCounts] = useState({ PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 });
  const [dayWeekOff, setDayWeekOff] = useState(false);

  const [dossier, setDossier] = useState<InternDossier | null>(null);
  const [internPeriod, setInternPeriod] = useState("");
  const [internCustomFrom, setInternCustomFrom] = useState("");
  const [internCustomTo, setInternCustomTo] = useState("");
  const [hireNote, setHireNote] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [attPage, setAttPage] = useState(1);
  const [attLimit, setAttLimit] = useState(10);
  const [taskPage, setTaskPage] = useState(1);
  const [taskLimit, setTaskLimit] = useState(10);
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [listExporting, setListExporting] = useState(false);
  const [dayExporting, setDayExporting] = useState(false);

  // Intern self view
  const [internRecords, setInternRecords] = useState<{ id: string; date: string; status: string }[]>([]);
  const [internSelfPage, setInternSelfPage] = useState(1);
  const [internSelfLimit, setInternSelfLimit] = useState(10);
  const [internSelfPagination, setInternSelfPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [internPct, setInternPct] = useState<{ attendanceRate: number; present: number; absent: number; leave: number } | null>(null);

  const members = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    return g?.members || [];
  }, [groups, groupId]);

  const selectedGroupCompleted = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    return g?.internshipStatus === "COMPLETED";
  }, [groups, groupId]);

  useEffect(() => {
    if (!groupId || !members.length) {
      setMarks({});
      return;
    }
    const next: Record<string, string> = {};
    for (const m of members) next[m.internId] = "ABSENT";
    setMarks(next);
  }, [groupId, members]);

  async function loadGroups() {
    if (isIntern) return;
    try {
      const g = await api.get("/groups");
      setGroups(g.data.groups || []);
    } catch {
      setGroups([]);
    }
  }

  async function loadDays() {
    const params = new URLSearchParams();
    params.set("period", period);
    if (period === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    if (reportGroupId !== "all") params.set("groupId", reportGroupId);
    setLoading(true);
    try {
      const { data } = await api.get(`/attendance/report/days?${params}`);
      setDays(data.days || []);
      setRangeMeta({
        from: data.from ? String(data.from).slice(0, 10) : undefined,
        to: data.to ? String(data.to).slice(0, 10) : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  async function openDay(d: string) {
    setSelectedDate(d);
    setDayGroupId(reportGroupId);
    setView("day");
    await loadDay(d, reportGroupId);
  }

  async function loadDay(d: string, gid: string) {
    const params = new URLSearchParams({ date: d });
    if (gid !== "all") params.set("groupId", gid);
    setLoading(true);
    try {
      const { data } = await api.get(`/attendance/report/day?${params}`);
      setDayRecords(data.records || []);
      setDayCounts(data.counts || { PRESENT: 0, ABSENT: 0, LEAVE: 0, WEEK_OFF: 0 });
      setDayWeekOff(!!data.isWeekOffDay);
    } finally {
      setLoading(false);
    }
  }

  async function openIntern(internId: string) {
    setInternSubTab("overview");
    setView("intern");
    setStatusMsg("");
    setExportErr("");
    setInternPeriod("");
    setInternCustomFrom("");
    setInternCustomTo("");
    setAttPage(1);
    setTaskPage(1);
    setTaskStatusFilter("all");
    await loadIntern(internId, "", { attPage: 1, taskPage: 1, taskStatus: "all" });
  }

  async function loadIntern(
    internId: string,
    p: string,
    opts?: {
      from?: string;
      to?: string;
      attPage?: number;
      attLimit?: number;
      taskPage?: number;
      taskLimit?: number;
      taskStatus?: string;
    },
  ) {
    setLoading(true);
    try {
      const ap = opts?.attPage ?? attPage;
      const al = opts?.attLimit ?? attLimit;
      const tp = opts?.taskPage ?? taskPage;
      const tl = opts?.taskLimit ?? taskLimit;
      const ts = opts?.taskStatus ?? taskStatusFilter;
      const from = opts?.from ?? internCustomFrom;
      const to = opts?.to ?? internCustomTo;
      const params = new URLSearchParams();
      if (p) params.set("period", p);
      if (p === "custom") {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      params.set("attPage", String(ap));
      params.set("attLimit", String(al));
      params.set("taskPage", String(tp));
      params.set("taskLimit", String(tl));
      if (ts && ts !== "all") params.set("taskStatus", ts);
      const { data } = await api.get(`/attendance/report/intern/${internId}?${params}`);
      setDossier(data);
      setHireNote(data.intern?.hireNote || "");
      if (data.selectedPeriod) setInternPeriod(data.selectedPeriod);
      if (data.attendance?.pagination?.page) setAttPage(data.attendance.pagination.page);
      if (data.tasks?.pagination?.page) setTaskPage(data.tasks.pagination.page);
    } finally {
      setLoading(false);
    }
  }

  async function exportInternExcel() {
    if (!dossier) return;
    setExporting(true);
    setExportErr("");
    try {
      await downloadExcel(
        `/attendance/report/intern/${dossier.intern.id}/export`,
        `intern-report-${dossier.intern.fullName.replace(/\s+/g, "-").toLowerCase()}.xlsx`,
      );
    } catch {
      setExportErr("Excel export failed");
    } finally {
      setExporting(false);
    }
  }

  async function exportPeriodExcel() {
    setListExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("period", period);
      if (period === "custom") {
        if (customFrom) params.set("from", customFrom);
        if (customTo) params.set("to", customTo);
      }
      if (reportGroupId !== "all") params.set("groupId", reportGroupId);
      await downloadExcel(`/attendance/report/period/export?${params}`, "attendance-period.xlsx");
    } catch {
      alert("Period export failed");
    } finally {
      setListExporting(false);
    }
  }

  async function exportDayExcel() {
    if (!selectedDate) return;
    setDayExporting(true);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (dayGroupId !== "all") params.set("groupId", dayGroupId);
      await downloadExcel(`/attendance/report/day/export?${params}`, `attendance-day-${selectedDate}.xlsx`);
    } catch {
      alert("Day export failed");
    } finally {
      setDayExporting(false);
    }
  }

  async function loadInternSelf(page = internSelfPage, limit = internSelfLimit) {
    try {
      const { data } = await api.get(`/attendance?page=${page}&limit=${limit}`);
      setInternRecords(data.records || []);
      if (data.pagination) setInternSelfPagination(data.pagination);
    } catch {
      setInternRecords([]);
    }
  }

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    if (isIntern || staffTab !== "report" || view !== "list") return;
    if (period === "custom" && (!customFrom || !customTo)) return;
    void loadDays();
  }, [isIntern, staffTab, view, period, customFrom, customTo, reportGroupId]);

  useEffect(() => {
    if (!isIntern) return;
    void loadInternSelf(internSelfPage, internSelfLimit);
  }, [isIntern, internSelfPage, internSelfLimit]);

  useEffect(() => {
    if (!isIntern) return;
    api
      .get("/analytics/me")
      .then((r) => {
        const p = r.data.performance;
        setInternPct({
          attendanceRate: p.attendanceRate,
          present: p.present,
          absent: p.absent,
          leave: p.leave,
        });
      })
      .catch(() => {});
  }, [isIntern]);

  async function saveEntries(entries: { internId: string; status: string }[], label: string) {
    setMarkMsg("");
    setMarkErr("");
    if (!entries.length) {
      setMarkErr("Select a group with members");
      return;
    }
    if (date > todayStr) {
      setMarkErr("Future date pe attendance mark nahi kar sakte");
      return;
    }
    try {
      const { data } = await api.post("/attendance/mark", { date, groupId, entries });
      setMarkMsg(`${label} — ${data.count} record(s)`);
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setMarkErr(ax.response?.data?.message || "Save failed");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    await saveEntries(
      members.map((m) => ({ internId: m.internId, status: marks[m.internId] || "ABSENT" })),
      "Attendance saved",
    );
  }

  async function markGroupWeekOff() {
    if (!groupId || !members.length) {
      setMarkErr("Pehle date aur group select karo");
      return;
    }
    if (!confirm(`Mark WEEK OFF for all ${members.length} members on ${date}?`)) return;
    const next: Record<string, string> = {};
    for (const m of members) next[m.internId] = "WEEK_OFF";
    setMarks(next);
    await saveEntries(
      members.map((m) => ({ internId: m.internId, status: "WEEK_OFF" })),
      "Group week off marked",
    );
  }

  async function updateInternStatus(payload: { internshipStatus?: string; isHired?: boolean; hireNote?: string }) {
    if (!dossier) return;
    setStatusMsg("");
    try {
      await api.patch(`/interns/${dossier.intern.id}/status`, payload);
      setStatusMsg("Updated");
      await loadIntern(dossier.intern.id, internPeriod || "");
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setStatusMsg(ax.response?.data?.message || "Failed");
    }
  }

  if (isIntern) {
    return (
      <div>
        <PageHeader title="My Attendance" subtitle="Present / Absent / Leave / Week off" />
        {internPct && (
          <div className="mb-6 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Your attendance %</p>
            <p className="mt-1 text-3xl font-bold text-teal-900">{internPct.attendanceRate}%</p>
            <p className="mt-1 text-sm text-slate-600">
              {internPct.present} present · {internPct.absent} absent · {internPct.leave} leave
            </p>
          </div>
        )}
        <div className="mb-3 flex justify-end">
          <PageSizeSelect
            value={internSelfLimit}
            onChange={(n) => {
              setInternSelfLimit(n);
              setInternSelfPage(1);
            }}
          />
        </div>
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {internRecords.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{formatDate(r.date)}</td>
                  <td className="px-4 py-3">
                    <Badge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {internRecords.length === 0 && <p className="p-4 text-sm text-slate-500">No records.</p>}
        </div>
        <Pager pagination={internSelfPagination} onChange={setInternSelfPage} />
      </div>
    );
  }

  const markTab = (
    <form onSubmit={save} className="space-y-4 rounded-xl border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-600">
          Date
          <input
            type="date"
            max={todayStr}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value > todayStr ? todayStr : e.target.value)}
          />
        </label>
        <label className="text-sm text-slate-600">
          Group
          <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">Select group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id} disabled={g.internshipStatus === "COMPLETED"}>
                {g.name}
                {g.internshipStatus === "COMPLETED" ? " (completed)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedGroupCompleted && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Is group ka internship complete hai — attendance lock.
        </p>
      )}

      {groupId && members.length > 0 && !selectedGroupCompleted && (
        <button
          type="button"
          onClick={() => void markGroupWeekOff()}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          Week off — whole group
        </button>
      )}

      <div className="space-y-2">
        <div className="hidden grid-cols-[1fr_repeat(4,minmax(0,4.25rem))] gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
          <span>Intern</span>
          <span className="text-center">Present</span>
          <span className="text-center">Absent</span>
          <span className="text-center">Leave</span>
          <span className="text-center">Week off</span>
        </div>
        {members.map((m) => {
          const value = marks[m.internId] || "ABSENT";
          return (
            <div
              key={m.internId}
              className="grid grid-cols-1 items-center gap-2 rounded-lg border border-slate-100 px-3 py-2.5 text-sm sm:grid-cols-[1fr_repeat(4,minmax(0,4.25rem))]"
            >
              <span className="font-medium text-slate-800">{m.intern.user.fullName}</span>
              {(
                [
                  { status: "PRESENT", label: "Present", on: "border-green-300 bg-green-50 text-green-800" },
                  { status: "ABSENT", label: "Absent", on: "border-rose-300 bg-rose-50 text-rose-800" },
                  { status: "LEAVE", label: "Leave", on: "border-amber-300 bg-amber-50 text-amber-900" },
                  { status: "WEEK_OFF", label: "Week off", on: "border-yellow-300 bg-yellow-50 text-yellow-900" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.status}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 sm:justify-center ${
                    value === opt.status ? opt.on : "border-transparent text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    className="h-4 w-4"
                    name={`att-${m.internId}`}
                    checked={value === opt.status}
                    disabled={selectedGroupCompleted}
                    onChange={() => setMarks((prev) => ({ ...prev, [m.internId]: opt.status }))}
                  />
                  <span className="text-xs sm:sr-only">{opt.label}</span>
                </label>
              ))}
            </div>
          );
        })}
        {!groupId && <p className="text-sm text-slate-500">Select a group. Default = Absent.</p>}
      </div>

      <button disabled={selectedGroupCompleted} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50">
        Save attendance
      </button>
      {markMsg && <p className="text-sm text-green-700">{markMsg}</p>}
      {markErr && <p className="text-sm text-red-600">{markErr}</p>}
    </form>
  );

  const daysList = (
    <>
      <div className="mb-4 rounded-xl border bg-white p-4">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void loadDays();
          }}
        >
          <label className="text-xs font-medium text-slate-600">
            Period
            <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Group filter
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={reportGroupId}
              onChange={(e) => setReportGroupId(e.target.value)}
            >
              <option value="all">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {period === "custom" && (
            <>
              <label className="text-xs font-medium text-slate-600">
                From
                <input type="date" max={todayStr} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-slate-600">
                To
                <input type="date" max={todayStr} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
              Apply
            </button>
            <button
              type="button"
              disabled={listExporting}
              onClick={() => void exportPeriodExcel()}
              className="rounded-lg border border-emerald-700 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {listExporting ? "Exporting…" : "Export period Excel"}
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Default: current week. Sirf woh dates jahan attendance mark hui hai. Export = us period ki full detail (saare students).
          {rangeMeta.from && rangeMeta.to ? ` · ${formatDate(rangeMeta.from)} → ${formatDate(rangeMeta.to)}` : ""}
        </p>
      </div>

      {loading && <p className="mb-2 text-xs text-slate-400">Loading…</p>}

      <div className="space-y-2">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => void openDay(d.date)}
            className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left hover:border-green-300 hover:bg-green-50/40"
          >
            <div>
              <p className="font-semibold text-slate-900">{formatDate(d.date)}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Marked by:{" "}
                {d.markedBy.length
                  ? d.markedBy.map((m) => `${m.fullName} (${roleLabel(m.role)})`).join(", ")
                  : "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {d.isWeekOffDay ? (
                <span className="rounded-full bg-yellow-50 px-2.5 py-1 text-yellow-800">Week off day · {d.weekOff}</span>
              ) : (
                <>
                  <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800">Present {d.present}</span>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Absent {d.absent}</span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">Leave {d.leave}</span>
                  {d.weekOff > 0 && (
                    <span className="rounded-full bg-yellow-50 px-2.5 py-1 text-yellow-800">Off {d.weekOff}</span>
                  )}
                </>
              )}
            </div>
          </button>
        ))}
        {!loading && days.length === 0 && (
          <p className="text-sm text-slate-500">Is period me koi marked attendance nahi mili.</p>
        )}
      </div>
    </>
  );

  const dayView = (
    <div className="space-y-4">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600" onClick={() => setView("list")}>
        <ArrowLeft className="h-4 w-4" /> Back to daily report
      </button>
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{formatDate(selectedDate)}</h2>
            {dayWeekOff && <p className="mt-1 text-sm text-amber-800">Full week-off day</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800">Present {dayCounts.PRESENT}</span>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Absent {dayCounts.ABSENT}</span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">Leave {dayCounts.LEAVE}</span>
              <span className="rounded-full bg-yellow-50 px-2.5 py-1 text-yellow-800">Week off {dayCounts.WEEK_OFF}</span>
            </div>
          </div>
          <button
            type="button"
            disabled={dayExporting}
            onClick={() => void exportDayExcel()}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {dayExporting ? "Exporting…" : "Export day Excel"}
          </button>
        </div>
        <label className="mt-4 block text-xs font-medium text-slate-600">
          Filter by group
          <select
            className="mt-1 w-full max-w-xs rounded-lg border px-3 py-2 text-sm"
            value={dayGroupId}
            onChange={(e) => {
              setDayGroupId(e.target.value);
              void loadDay(selectedDate, e.target.value);
            }}
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">College</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Marked by</th>
            </tr>
          </thead>
          <tbody>
            {dayRecords.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-medium text-green-700 hover:underline"
                    onClick={() => r.intern?.id && void openIntern(r.intern.id)}
                  >
                    {r.intern?.user.fullName || "—"}
                  </button>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.groupName || "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.collegeName || "—"}</td>
                <td className="px-3 py-2">
                  <Badge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.markedByName ? `${r.markedByName} (${roleLabel(r.markedByRole)})` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && dayRecords.length === 0 && <p className="p-4 text-sm text-slate-500">No records.</p>}
      </div>
    </div>
  );

  const internView =
    dossier && (
      <div className="space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600"
          onClick={() => {
            setDossier(null);
            setView(selectedDate ? "day" : "list");
          }}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{dossier.intern.fullName}</h2>
              <p className="text-sm text-slate-500">
                {dossier.intern.email}
                {dossier.intern.college ? ` · ${dossier.intern.college.name}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2.5 py-1 ${
                  dossier.intern.internshipStatus === "COMPLETED"
                    ? "bg-slate-200 text-slate-800"
                    : "bg-green-50 text-green-800"
                }`}
              >
                {dossier.intern.internshipStatus === "COMPLETED" ? "Internship completed" : "Internship active"}
              </span>
              {dossier.intern.isHired && (
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">Hired</span>
              )}
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportInternExcel()}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Export Excel"}
              </button>
            </div>
          </div>
          {exportErr && <p className="mt-2 text-sm text-rose-600">{exportErr}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Excel: full DB report (all attendance + all tasks) · Dashboard charts · Attendance/Tasks sheets with filters.

          </p>
        </div>

        <div className="flex gap-1 rounded-xl border bg-white p-1">
          {(
            [
              ["overview", "Overview"],
              ["attendance", "Attendance"],
              ["tasks", "Tasks"],
              ["status", "Status / Hire"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setInternSubTab(id)}
              className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium sm:text-sm ${
                internSubTab === id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {internSubTab === "overview" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">Overall score</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{dossier.performance.score}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">Attendance %</p>
              <p className="mt-1 text-3xl font-bold text-teal-800">{dossier.performance.attendanceRate}%</p>
              <p className="mt-1 text-xs text-slate-500">
                P {dossier.performance.present} · A {dossier.performance.absent} · L {dossier.performance.leave}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">Task completion %</p>
              <p className="mt-1 text-3xl font-bold text-green-800">{dossier.performance.taskCompletionRate}%</p>
              <p className="mt-1 text-xs text-slate-500">
                Done {dossier.performance.doneTasks}/{dossier.performance.totalTasks}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4 sm:col-span-2 lg:col-span-1">
              <p className="text-xs text-slate-500">Current groups</p>
              <ul className="mt-2 space-y-1 text-sm">
                {dossier.intern.groups.map((g) => (
                  <li key={g.id}>
                    {g.name}
                    <span className="text-xs text-slate-400">
                      {" "}
                      · {g.internshipStatus === "COMPLETED" ? "group completed" : "active"}
                    </span>
                  </li>
                ))}
                {dossier.intern.groups.length === 0 && <li className="text-slate-400">No active group</li>}
              </ul>
              {(dossier.intern.pastGroups?.length ?? 0) > 0 && (
                <>
                  <p className="mt-3 text-xs text-slate-500">Previous groups</p>
                  <ul className="mt-1 space-y-1 text-xs text-slate-500">
                    {dossier.intern.pastGroups!.map((g) => (
                      <li key={`past-${g.id}`}>
                        {g.name}
                        {g.leftAt ? ` · left ${formatDate(g.leftAt)}` : " · past"}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {internSubTab === "attendance" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-600">
                Period
                <select
                  className="mt-1 block rounded-lg border px-2 py-1.5 text-sm"
                  value={internPeriod}
                  onChange={(e) => {
                    const next = e.target.value;
                    setInternPeriod(next);
                    setAttPage(1);
                    if (next !== "custom") {
                      void loadIntern(dossier.intern.id, next, { attPage: 1 });
                    }
                  }}
                >
                  {(dossier.periodOptions || []).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {internPeriod === "custom" && (
                <>
                  <label className="text-xs font-medium text-slate-600">
                    From
                    <input
                      type="date"
                      max={todayStr}
                      className="mt-1 block rounded-lg border px-2 py-1.5 text-sm"
                      value={internCustomFrom}
                      onChange={(e) => setInternCustomFrom(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    To
                    <input
                      type="date"
                      max={todayStr}
                      className="mt-1 block rounded-lg border px-2 py-1.5 text-sm"
                      value={internCustomTo}
                      onChange={(e) => setInternCustomTo(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white"
                    onClick={() => {
                      setAttPage(1);
                      void loadIntern(dossier.intern.id, "custom", {
                        from: internCustomFrom,
                        to: internCustomTo,
                        attPage: 1,
                      });
                    }}
                  >
                    Apply
                  </button>
                </>
              )}
              <PageSizeSelect
                value={attLimit}
                onChange={(n) => {
                  setAttLimit(n);
                  setAttPage(1);
                  void loadIntern(dossier.intern.id, internPeriod || "", { attPage: 1, attLimit: n });
                }}
              />
            </div>
            <p className="text-xs text-slate-400">
              Options is intern ke actual period se aate hain (jis month me attendance / internship thi).
            </p>
            {loading && <p className="text-xs text-slate-400">Loading…</p>}
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Marked by</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.attendance.records.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{formatDate(r.date)}</td>
                      <td className="px-3 py-2">
                        <Badge status={r.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.markedBy ? `${r.markedBy.fullName} (${roleLabel(r.markedBy.role)})` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dossier.attendance.records.length === 0 && (
                <p className="p-4 text-sm text-slate-500">No attendance in this period.</p>
              )}
            </div>
            <Pager
              pagination={dossier.attendance.pagination}
              onChange={(page) => {
                setAttPage(page);
                void loadIntern(dossier.intern.id, internPeriod || "", { attPage: page });
              }}
            />
          </div>
        )}

        {internSubTab === "tasks" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-600">
                Status
                <select
                  className="mt-1 block rounded-lg border px-2 py-1.5 text-sm"
                  value={taskStatusFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTaskStatusFilter(next);
                    setTaskPage(1);
                    void loadIntern(dossier.intern.id, internPeriod || "", {
                      taskPage: 1,
                      taskStatus: next,
                    });
                  }}
                >
                  {TASK_STATUS_FILTERS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <PageSizeSelect
                value={taskLimit}
                onChange={(n) => {
                  setTaskLimit(n);
                  setTaskPage(1);
                  void loadIntern(dossier.intern.id, internPeriod || "", { taskPage: 1, taskLimit: n });
                }}
              />
            </div>
            {loading && <p className="text-xs text-slate-400">Loading…</p>}
            <div className="space-y-2">
              {dossier.tasks.records.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Day {t.dayNumber} · Task {t.taskNumber}: {t.title}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(t.forDate)}</p>
                  </div>
                  <Badge status={t.status} />
                </div>
              ))}
              {dossier.tasks.records.length === 0 && <p className="text-sm text-slate-500">No tasks assigned.</p>}
            </div>
            <Pager
              pagination={dossier.tasks.pagination}
              onChange={(page) => {
                setTaskPage(page);
                void loadIntern(dossier.intern.id, internPeriod || "", { taskPage: page });
              }}
            />
          </div>
        )}

        {internSubTab === "status" && (
          <div className="space-y-4 rounded-xl border bg-white p-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Internship</p>
              <p className="mt-1 text-sm text-slate-600">
                Status: <strong>{dossier.intern.internshipStatus === "COMPLETED" ? "Completed" : "Active / running"}</strong>
                {dossier.intern.completedAt ? ` · ${formatDate(dossier.intern.completedAt)}` : ""}
                {dossier.intern.completedBy
                  ? ` by ${dossier.intern.completedBy.fullName} (${roleLabel(dossier.intern.completedBy.role)})`
                  : ""}
              </p>
              {canManageStatus && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {dossier.intern.internshipStatus !== "COMPLETED" ? (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      onClick={() => {
                        if (confirm("Mark internship completed? Attendance will lock for this intern.")) {
                          void updateInternStatus({ internshipStatus: "COMPLETED" });
                        }
                      }}
                    >
                      Mark internship completed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-2 text-sm"
                      onClick={() => void updateInternStatus({ internshipStatus: "ACTIVE" })}
                    >
                      Reopen internship
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-slate-800">Job / hire</p>
              <p className="mt-1 text-sm text-slate-600">
                {dossier.intern.isHired
                  ? `Hired${dossier.intern.hiredAt ? ` · ${formatDate(dossier.intern.hiredAt)}` : ""}${
                      dossier.intern.hiredBy
                        ? ` by ${dossier.intern.hiredBy.fullName} (${roleLabel(dossier.intern.hiredBy.role)})`
                        : ""
                    }`
                  : "Not hired yet"}
              </p>
              {dossier.intern.hireNote && <p className="mt-1 text-xs text-slate-500">Note: {dossier.intern.hireNote}</p>}
              {canManageStatus && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    rows={2}
                    placeholder="Hire note (optional)"
                    value={hireNote}
                    onChange={(e) => setHireNote(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {!dossier.intern.isHired ? (
                      <button
                        type="button"
                        className="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white"
                        onClick={() => void updateInternStatus({ isHired: true, hireNote })}
                      >
                        Mark as hired (offer accepted)
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 text-sm"
                        onClick={() => void updateInternStatus({ isHired: false })}
                      >
                        Clear hired status
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {statusMsg && <p className="text-sm text-green-700">{statusMsg}</p>}
          </div>
        )}
      </div>
    );

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Mark · daily report · student dossier" />

      {canMark && view === "list" && (
        <div className="mb-5 flex gap-1 rounded-xl border bg-white p-1">
          <button
            type="button"
            onClick={() => setStaffTab("mark")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              staffTab === "mark" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Mark attendance
          </button>
          <button
            type="button"
            onClick={() => setStaffTab("report")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              staffTab === "report" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Daily report
          </button>
        </div>
      )}

      {view === "list" && staffTab === "mark" && canMark && markTab}
      {view === "list" && (staffTab === "report" || !canMark) && daysList}
      {view === "day" && dayView}
      {view === "intern" && internView}
    </div>
  );
}
