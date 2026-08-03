import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import { downloadExcel } from "../../api/downloadExcel";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type Assignment = {
  id: string;
  status: string;
  forDate?: string;
  dayNumber?: number;
  taskNumber?: number;
  displayLabel?: string;
  groupId?: string | null;
  groupName?: string | null;
  collegeName?: string | null;
  assignedBy?: { id: string; fullName: string; email: string; role?: string | null } | null;
  assignedAt?: string;
  submittedAt?: string | null;
  lastReview?: {
    status: string;
    comment: string;
    at: string;
    by: string | null;
    byId: string | null;
    byRole?: string | null;
  } | null;
  reviewHistory?: {
    status: string;
    comment: string;
    at: string;
    by: string | null;
    byRole?: string | null;
  }[];
  task: { id: string; title: string; description: string; dueDate?: string | null };
  intern?: { id: string; user: { fullName: string; email: string } };
  submission?: {
    projectDetails: string;
    githubUrl: string;
    liveUrl?: string | null;
    feedbacks?: { comment: string; newStatus: string; reviewer?: { fullName: string; role?: string } }[];
  } | null;
};

function roleLabel(role?: string | null) {
  if (!role) return "";
  if (role === "TRAINER") return "Trainer";
  if (role === "HR") return "HR";
  if (role === "ADMIN") return "Admin";
  return role;
}

function personLabel(name?: string | null, role?: string | null) {
  if (!name) return "—";
  const r = roleLabel(role);
  return r ? `${name} (${r})` : name;
}

type TaskBatch = {
  key: string;
  taskId: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string;
  forDate: string;
  dayNumber: number;
  taskNumber: number;
  displayLabel: string;
  total: number;
  counts: StatusCounts;
  assignedBy?: { id: string; fullName: string; email: string; role?: string } | null;
  assignedAt?: string | null;
  reviewers?: { id?: string; fullName: string; role: string }[];
};

type LibraryTask = {
  id: string;
  title: string;
  description: string;
  libraryOrder?: number | null;
  assignmentCount?: number;
  assignees?: {
    internId: string;
    fullName: string;
    email: string;
    groupName: string | null;
    forDate: string;
  }[];
  _count?: { assignments: number };
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type StatusCounts = {
  ASSIGNED: number;
  SUBMITTED: number;
  NEEDS_IMPROVEMENT: number;
  DONE: number;
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "ASSIGNED", label: "Assigned (not submitted)" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs improvement" },
  { value: "DONE", label: "Done" },
];

const PAGE_SIZES = [10, 20, 30] as const;

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

export function TasksPage() {
  const { user } = useAuth();
  const isIntern = user?.role === "INTERN";
  const canAssign = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const canReview = canAssign;
  const showAudit = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const isCollege = user?.role === "COLLEGE";

  const [staffTab, setStaffTab] = useState<"assign" | "manage">("manage");

  // Intern list
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // Staff manage: task batches (inside one open group)
  const [batches, setBatches] = useState<TaskBatch[]>([]);
  const [groupSummaries, setGroupSummaries] = useState<
    {
      groupId: string;
      groupName: string;
      taskCount: number;
      internAssignments: number;
      counts: StatusCounts;
    }[]
  >([]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [groupPagination, setGroupPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    ASSIGNED: 0,
    SUBMITTED: 0,
    NEEDS_IMPROVEMENT: 0,
    DONE: 0,
  });
  const [groupPage, setGroupPage] = useState(1);
  const [groupLimit, setGroupLimit] = useState(10);

  // Intern pagination (unchanged)
  const [assignPagination, setAssignPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [assignPage, setAssignPage] = useState(1);
  const [assignLimit, setAssignLimit] = useState(10);

  const [selectedBatch, setSelectedBatch] = useState<TaskBatch | null>(null);
  const [batchInterns, setBatchInterns] = useState<Assignment[]>([]);
  const [batchCounts, setBatchCounts] = useState<StatusCounts | null>(null);
  const [batchTaskDesc, setBatchTaskDesc] = useState("");
  const [selectedInternId, setSelectedInternId] = useState<string | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(false);

  const [library, setLibrary] = useState<LibraryTask[]>([]);
  const [libraryOptions, setLibraryOptions] = useState<{ id: string; title: string; libraryOrder?: number | null }[]>([]);
  const [libPagination, setLibPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [libPage, setLibPage] = useState(1);
  const [libLimit, setLibLimit] = useState(10);
  const [libSearch, setLibSearch] = useState("");
  const [expandedLib, setExpandedLib] = useState<Record<string, boolean>>({});
  const [editingLib, setEditingLib] = useState<LibraryTask | null>(null);
  const [editLibTitle, setEditLibTitle] = useState("");
  const [editLibDesc, setEditLibDesc] = useState("");
  const [editLibOrder, setEditLibOrder] = useState("1");
  const [alreadyAssignedWarn, setAlreadyAssignedWarn] = useState<{
    count: number;
    names: string[];
    message: string | null;
  } | null>(null);
  const [saveLibOrder, setSaveLibOrder] = useState("");

  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState<"assign" | "save">("assign");
  const [libraryTaskId, setLibraryTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [forDate, setForDate] = useState(new Date().toISOString().slice(0, 10));
  const [groupId, setGroupId] = useState("");
  const [alsoSave, setAlsoSave] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [formErr, setFormErr] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [assignedByFilter, setAssignedByFilter] = useState("all");
  const [reviewedByFilter, setReviewedByFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [assigners, setAssigners] = useState<{ id: string; fullName: string; role: string }[]>([]);
  const [reviewers, setReviewers] = useState<{ id: string; fullName: string; role: string }[]>([]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const [submitErr, setSubmitErr] = useState<Record<string, string>>({});
  const [submitForms, setSubmitForms] = useState<Record<string, { projectDetails: string; githubUrl: string; liveUrl: string }>>({});
  const [reviewForms, setReviewForms] = useState<Record<string, { comment: string; status: string }>>({});
  const [editingTask, setEditingTask] = useState<Assignment | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [exportingTasks, setExportingTasks] = useState(false);

  async function exportTasksExcel() {
    setExportingTasks(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (groupFilter && groupFilter !== "all") params.set("groupId", groupFilter);
      if (search.trim()) params.set("search", search.trim());
      if (assignedByFilter && assignedByFilter !== "all") params.set("assignedById", assignedByFilter);
      if (reviewedByFilter && reviewedByFilter !== "all") params.set("reviewedById", reviewedByFilter);
      const qs = params.toString();
      await downloadExcel(`/tasks/export${qs ? `?${qs}` : ""}`, "tasks-export.xlsx");
    } catch {
      alert("Tasks export failed");
    } finally {
      setExportingTasks(false);
    }
  }

  async function exportBatchExcel() {
    if (!selectedBatch) return;
    setExportingTasks(true);
    try {
      const params = new URLSearchParams({
        taskId: selectedBatch.taskId,
        groupId: selectedBatch.groupId,
      });
      await downloadExcel(`/tasks/batches/export?${params}`, "task-manage-export.xlsx");
    } catch {
      alert("Task export failed");
    } finally {
      setExportingTasks(false);
    }
  }

  async function loadGroups() {
    if (!(canAssign || isCollege || showAudit)) return;
    const g = await api.get("/groups");
    setGroups(g.data.groups.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
  }

  async function loadInternAssignments(opts?: { page?: number; limit?: number }) {
    const page = opts?.page ?? assignPage;
    const limit = opts?.limit ?? assignLimit;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    setLoadingList(true);
    try {
      const { data } = await api.get(`/tasks?${params}`);
      setAssignments(data.assignments || []);
      if (data.pagination) setAssignPagination(data.pagination);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadActors() {
    if (isIntern) return;
    const params = new URLSearchParams();
    if (groupFilter !== "all") params.set("groupId", groupFilter);
    const { data } = await api.get(`/tasks/batches/actors${params.toString() ? `?${params}` : ""}`);
    setAssigners(data.assigners || []);
    setReviewers(data.reviewers || []);
    // Drop stale filter selections that are no longer in the dropdown
    if (
      assignedByFilter !== "all" &&
      !(data.assigners || []).some((a: { id: string }) => a.id === assignedByFilter)
    ) {
      setAssignedByFilter("all");
    }
    if (
      reviewedByFilter !== "all" &&
      !(data.reviewers || []).some((r: { id: string }) => r.id === reviewedByFilter)
    ) {
      setReviewedByFilter("all");
    }
  }

  async function loadGroupSummaries(opts?: { search?: string }) {
    const q = opts?.search ?? search;
    const params = new URLSearchParams();
    params.set("view", "groups");
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (groupFilter !== "all") params.set("groupId", groupFilter);
    if (assignedByFilter !== "all") params.set("assignedById", assignedByFilter);
    if (reviewedByFilter !== "all") params.set("reviewedById", reviewedByFilter);
    if (q.trim()) params.set("search", q.trim());
    setLoadingList(true);
    try {
      const { data } = await api.get(`/tasks/batches?${params}`);
      setGroupSummaries(data.groups || []);
      if (data.statusCounts) setStatusCounts(data.statusCounts);
      if (openGroupId && !(data.groups || []).some((g: { groupId: string }) => g.groupId === openGroupId)) {
        setOpenGroupId(null);
        setBatches([]);
      }
    } finally {
      setLoadingList(false);
    }
  }

  async function loadGroupBatches(
    groupId: string,
    opts?: { page?: number; limit?: number; search?: string },
  ) {
    const page = opts?.page ?? groupPage;
    const limit = opts?.limit ?? groupLimit;
    const q = opts?.search ?? search;
    const params = new URLSearchParams();
    params.set("groupId", groupId);
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (assignedByFilter !== "all") params.set("assignedById", assignedByFilter);
    if (reviewedByFilter !== "all") params.set("reviewedById", reviewedByFilter);
    if (q.trim()) params.set("search", q.trim());
    setLoadingList(true);
    try {
      const { data } = await api.get(`/tasks/batches?${params}`);
      setBatches(data.batches || []);
      if (data.pagination) setGroupPagination(data.pagination);
    } finally {
      setLoadingList(false);
    }
  }

  async function toggleGroup(groupId: string) {
    if (openGroupId === groupId) {
      setOpenGroupId(null);
      setBatches([]);
      return;
    }
    setOpenGroupId(groupId);
    setGroupPage(1);
    await loadGroupBatches(groupId, { page: 1 });
  }

  async function openBatch(batch: TaskBatch) {
    setSelectedBatch(batch);
    setSelectedInternId(null);
    setLoadingBatch(true);
    try {
      const params = new URLSearchParams({ taskId: batch.taskId, groupId: batch.groupId });
      const { data } = await api.get(`/tasks/batches/interns?${params}`);
      setBatchInterns(data.assignments || []);
      setBatchCounts(data.counts || null);
      setBatchTaskDesc(data.task?.description || batch.description);
    } finally {
      setLoadingBatch(false);
    }
  }

  async function refreshBatchInterns() {
    if (!selectedBatch) return;
    const params = new URLSearchParams({ taskId: selectedBatch.taskId, groupId: selectedBatch.groupId });
    const { data } = await api.get(`/tasks/batches/interns?${params}`);
    setBatchInterns(data.assignments || []);
    setBatchCounts(data.counts || null);
    await loadGroupSummaries();
    if (openGroupId) await loadGroupBatches(openGroupId);
  }

  async function loadLibrary(opts?: { page?: number; limit?: number; search?: string }) {
    if (!canAssign) return;
    const page = opts?.page ?? libPage;
    const limit = opts?.limit ?? libLimit;
    const q = opts?.search ?? libSearch;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (q.trim()) params.set("search", q.trim());
    const { data } = await api.get(`/tasks/library?${params}`);
    setLibrary(data.tasks || []);
    if (data.pagination) setLibPagination(data.pagination);
  }

  async function loadLibraryOptions() {
    if (!canAssign) return;
    const { data } = await api.get("/tasks/library?options=1");
    setLibraryOptions(data.tasks || []);
  }

  async function checkAlreadyAssigned(libId: string, gId: string) {
    if (!libId || !gId) {
      setAlreadyAssignedWarn(null);
      return;
    }
    try {
      const { data } = await api.get(`/tasks/library/${libId}/already-assigned`, {
        params: { groupId: gId },
      });
      if (data.count > 0) {
        setAlreadyAssignedWarn({
          count: data.count,
          names: (data.alreadyAssigned || []).map((x: { fullName: string }) => x.fullName),
          message: data.message,
        });
      } else {
        setAlreadyAssignedWarn(null);
      }
    } catch {
      setAlreadyAssignedWarn(null);
    }
  }

  useEffect(() => {
    if (mode === "assign" && libraryTaskId && groupId) {
      void checkAlreadyAssigned(libraryTaskId, groupId);
    } else {
      setAlreadyAssignedWarn(null);
    }
  }, [mode, libraryTaskId, groupId]);

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    if (!isIntern) return;
    void loadInternAssignments();
  }, [isIntern, assignPage, assignLimit]);

  useEffect(() => {
    if (isIntern) return;
    if (canAssign && staffTab !== "manage") return;
    if (selectedBatch) return;
    void loadActors();
    void loadGroupSummaries();
  }, [isIntern, staffTab, statusFilter, groupFilter, assignedByFilter, reviewedByFilter]);

  useEffect(() => {
    if (!openGroupId || selectedBatch) return;
    void loadGroupBatches(openGroupId);
  }, [groupPage, groupLimit]);

  useEffect(() => {
    if (!canAssign || staffTab !== "assign") return;
    void loadLibrary();
    void loadLibraryOptions();
  }, [canAssign, staffTab, libPage, libLimit]);

  function applySearch(e?: FormEvent) {
    e?.preventDefault();
    setSelectedBatch(null);
    setGroupPage(1);
    void loadGroupSummaries({ search }).then(() => {
      if (openGroupId) void loadGroupBatches(openGroupId, { page: 1, search });
    });
  }

  function applyLibSearch(e?: FormEvent) {
    e?.preventDefault();
    setLibPage(1);
    void loadLibrary({ page: 1, search: libSearch });
  }

  function label(a: Assignment) {
    if (a.displayLabel) return a.displayLabel;
    if (a.dayNumber && a.taskNumber) return `Day ${a.dayNumber} · Task ${a.taskNumber}: ${a.task.title}`;
    return a.task.title;
  }

  async function onStaffSubmit(e: FormEvent) {
    e.preventDefault();
    setFormMsg("");
    setFormErr("");
    try {
      if (mode === "save") {
        await api.post("/tasks/library", {
          title,
          description,
          ...(saveLibOrder.trim() ? { libraryOrder: Number(saveLibOrder) } : {}),
        });
        setFormMsg("Saved to library — assign anytime to any group/date");
        setTitle("");
        setDescription("");
        setSaveLibOrder("");
        await Promise.all([loadLibrary({ page: libPage }), loadLibraryOptions()]);
        return;
      }

      let assignedCount = 0;
      let skippedCount = 0;
      let successMsg = "";
      const assignGroupId = groupId;

      if (libraryTaskId) {
        const { data } = await api.post(`/tasks/${libraryTaskId}/assign`, {
          forDate,
          groupId: assignGroupId || undefined,
        });
        assignedCount = data.assignedCount ?? 0;
        skippedCount = data.skippedCount ?? 0;
        if (data.warning) {
          successMsg =
            `Assigned to ${assignedCount} intern(s). ${data.warning}` +
            (assignGroupId ? " · Manage tab me group open karke dekho" : "");
        }
      } else {
        const { data } = await api.post("/tasks", {
          title,
          description,
          forDate,
          groupId: assignGroupId || undefined,
          alsoSaveToLibrary: alsoSave,
        });
        assignedCount = data.assignedCount ?? data.assignments?.length ?? 0;
        skippedCount = data.skippedCount ?? 0;
        setTitle("");
        setDescription("");
      }

      if (assignedCount === 0) {
        setFormErr(
          skippedCount
            ? `Koi naya assign nahi hua — ${skippedCount} intern(s) pe yeh task pehle se hai. Manage → group open karke dekho.`
            : "Assign fail — koi intern select/group me nahi mila",
        );
      } else {
        setFormMsg(
          successMsg ||
            `Assigned to ${assignedCount} intern(s)` +
              (skippedCount ? ` · ${skippedCount} already had it (skipped)` : "") +
              " · Manage tab me group open karke dekho",
        );
      }
      if (assignedCount > 0 && assignGroupId) {
        setStaffTab("manage");
        setSelectedBatch(null);
        setOpenGroupId(assignGroupId);
        setGroupPage(1);
        await loadGroupSummaries();
        await loadGroupBatches(assignGroupId, { page: 1 });
      }

      await Promise.all([loadLibrary({ page: libPage }), loadLibraryOptions()]);
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setFormErr(ax.response?.data?.message || "Failed");
    }
  }

  async function submitWork(id: string) {
    const form = submitForms[id];
    if (!form) {
      setSubmitErr((e) => ({ ...e, [id]: "Fill project details and GitHub URL" }));
      return;
    }
    setSubmitErr((e) => ({ ...e, [id]: "" }));
    try {
      await api.post(`/tasks/assignments/${id}/submit`, {
        projectDetails: form.projectDetails?.trim(),
        githubUrl: form.githubUrl?.trim(),
        liveUrl: form.liveUrl?.trim() || "",
      });
      setMarking((m) => ({ ...m, [id]: false }));
      await loadInternAssignments();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setSubmitErr((e) => ({ ...e, [id]: ax.response?.data?.message || "Submit failed" }));
    }
  }

  async function review(id: string) {
    const form = reviewForms[id];
    if (!form?.comment) return;
    await api.post(`/tasks/assignments/${id}/review`, form);
    await refreshBatchInterns();
  }

  async function saveTaskEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingTask) return;
    await api.patch(`/tasks/${editingTask.task.id}`, { title: editTitle, description: editDesc });
    setEditingTask(null);
    if (selectedBatch) await refreshBatchInterns();
    else {
      await loadGroupSummaries();
      if (openGroupId) await loadGroupBatches(openGroupId);
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task for all assigned interns?")) return;
    await api.delete(`/tasks/${taskId}`);
    setSelectedBatch(null);
    await loadGroupSummaries();
    if (openGroupId) await loadGroupBatches(openGroupId);
  }

  async function deleteAssignment(id: string) {
    if (!confirm("Remove this assignment for this intern only?")) return;
    await api.delete(`/tasks/assignments/${id}`);
    await refreshBatchInterns();
  }

  async function deleteLibrary(id: string) {
    if (!confirm("Delete this saved task from library?")) return;
    await api.delete(`/tasks/${id}`);
    await Promise.all([loadLibrary({ page: libPage }), loadLibraryOptions()]);
  }

  function openLibEdit(t: LibraryTask) {
    setEditingLib(t);
    setEditLibTitle(t.title);
    setEditLibDesc(t.description);
    setEditLibOrder(String(t.libraryOrder || 1));
  }

  async function saveLibEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingLib) return;
    await api.patch(`/tasks/${editingLib.id}`, {
      title: editLibTitle,
      description: editLibDesc,
      libraryOrder: Number(editLibOrder) || 1,
    });
    setEditingLib(null);
    await Promise.all([loadLibrary({ page: libPage }), loadLibraryOptions()]);
  }

  function renderInternDetail(a: Assignment) {
    const history = a.reviewHistory?.length
      ? a.reviewHistory
      : (a.submission?.feedbacks || []).map((f) => ({
          status: f.newStatus,
          comment: f.comment,
          at: "",
          by: f.reviewer?.fullName || null,
          byRole: f.reviewer?.role || null,
        }));

    return (
      <div className="space-y-3 border-t px-4 pb-4 pt-3">
        {showAudit && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Activity / audit</p>
            <p className="mt-1">
              Assigned by: <span className="font-medium">{personLabel(a.assignedBy?.fullName, a.assignedBy?.role)}</span>
              {a.assignedAt ? ` · ${formatDate(a.assignedAt)}` : ""}
            </p>
            {a.submittedAt && <p>Submitted: {formatDate(a.submittedAt)}</p>}
            {a.lastReview && (
              <p className="mt-1">
                Last check: <span className="font-medium">{personLabel(a.lastReview.by, a.lastReview.byRole)}</span>
                {" → "}
                {a.lastReview.status}
                {" · "}
                {formatDate(a.lastReview.at)}
              </p>
            )}
            {history.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                <p className="font-semibold text-slate-800">All remarks</p>
                {history.map((f, i) => (
                  <div key={i} className="rounded-md bg-white px-2.5 py-2 text-xs">
                    <p className="font-medium text-slate-800">
                      {personLabel(f.by, f.byRole)}
                      <span className="ml-1 font-normal text-slate-500">
                        → {f.status}
                        {f.at ? ` · ${formatDate(f.at)}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{f.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canAssign && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
              onClick={() => {
                setEditingTask(a);
                setEditTitle(a.task.title);
                setEditDesc(a.task.description);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit task
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
              onClick={() => void deleteAssignment(a.id)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove for intern
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
              onClick={() => void deleteTask(a.task.id)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete task (all)
            </button>
          </div>
        )}

        {a.submission ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">Submission</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.submission.projectDetails}</p>
            <p className="mt-2 flex flex-wrap gap-3">
              <a className="font-medium text-green-700 underline" href={a.submission.githubUrl} target="_blank" rel="noreferrer">
                Open GitHub
              </a>
              {a.submission.liveUrl ? (
                <a className="font-medium text-green-700 underline" href={a.submission.liveUrl} target="_blank" rel="noreferrer">
                  Open Live
                </a>
              ) : null}
            </p>
            {(a.submission.feedbacks || []).map((f, i) => (
              <p key={i} className="mt-2 border-t pt-2 text-xs text-slate-600">
                Feedback ({personLabel(f.reviewer?.fullName, f.reviewer?.role)}): {f.comment}
              </p>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Not submitted yet.
          </p>
        )}

        {canReview && (a.status === "SUBMITTED" || a.status === "NEEDS_IMPROVEMENT") && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium text-slate-800">Review / mark</p>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm"
              rows={2}
              placeholder="Feedback / suggestions"
              value={reviewForms[a.id]?.comment || ""}
              onChange={(e) =>
                setReviewForms({
                  ...reviewForms,
                  [a.id]: { ...(reviewForms[a.id] || { status: "DONE" }), comment: e.target.value },
                })
              }
            />
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg border px-3 py-2 text-sm"
                value={reviewForms[a.id]?.status || "DONE"}
                onChange={(e) =>
                  setReviewForms({
                    ...reviewForms,
                    [a.id]: { ...(reviewForms[a.id] || { comment: "" }), status: e.target.value },
                  })
                }
              >
                <option value="DONE">Mark Done</option>
                <option value="NEEDS_IMPROVEMENT">Needs improvement</option>
              </select>
              <button type="button" onClick={() => void review(a.id)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
                Submit review
              </button>
            </div>
          </div>
        )}

        {canReview && a.status === "DONE" && (
          <p className="text-xs text-green-700">Already marked done.</p>
        )}
      </div>
    );
  }

  function renderAssignmentCard(a: Assignment) {
    const open = !!expanded[a.id];
    const showMark = !!marking[a.id];
    return (
      <div key={a.id} className="rounded-xl border bg-white">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-2 p-4 text-left"
          onClick={() => setExpanded((e) => ({ ...e, [a.id]: !e[a.id] }))}
        >
          <div className="flex min-w-0 items-start gap-2">
            {open ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            )}
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900">{label(a)}</h3>
              <p className="text-xs text-slate-400">For: {formatDate(a.forDate)}</p>
            </div>
          </div>
          <Badge status={a.status} />
        </button>

        {open && (
          <div className="space-y-3 border-t px-4 pb-4 pt-3">
            <p className="whitespace-pre-wrap text-sm text-slate-600">{a.task.description}</p>
            <p className="text-xs text-slate-400">Due: {formatDate(a.task.dueDate || a.forDate)}</p>

            {isIntern && a.status !== "DONE" && !showMark && (
              <button
                type="button"
                className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  setMarking((m) => ({ ...m, [a.id]: true }));
                }}
              >
                Mark Task
              </button>
            )}

            {isIntern && a.status !== "DONE" && showMark && (
              <div className="space-y-2 rounded-lg border border-green-100 bg-green-50/50 p-3" onClick={(e) => e.stopPropagation()}>
                <p className="text-sm font-medium text-green-800">Submit your work</p>
                <textarea
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Project details (min 5 characters)"
                  value={submitForms[a.id]?.projectDetails || ""}
                  onChange={(e) =>
                    setSubmitForms({
                      ...submitForms,
                      [a.id]: { ...(submitForms[a.id] || { githubUrl: "", liveUrl: "" }), projectDetails: e.target.value },
                    })
                  }
                />
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="GitHub URL (https://github.com/...)"
                  value={submitForms[a.id]?.githubUrl || ""}
                  onChange={(e) =>
                    setSubmitForms({
                      ...submitForms,
                      [a.id]: { ...(submitForms[a.id] || { projectDetails: "", liveUrl: "" }), githubUrl: e.target.value },
                    })
                  }
                />
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Live URL (optional)"
                  value={submitForms[a.id]?.liveUrl || ""}
                  onChange={(e) =>
                    setSubmitForms({
                      ...submitForms,
                      [a.id]: { ...(submitForms[a.id] || { projectDetails: "", githubUrl: "" }), liveUrl: e.target.value },
                    })
                  }
                />
                {submitErr[a.id] && <p className="text-sm text-red-600">{submitErr[a.id]}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => void submitWork(a.id)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
                    Submit
                  </button>
                  <button type="button" onClick={() => setMarking((m) => ({ ...m, [a.id]: false }))} className="rounded-lg border px-4 py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {a.submission && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium">Your submission</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.submission.projectDetails}</p>
                <p className="mt-2">
                  <a className="text-green-700 underline" href={a.submission.githubUrl} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                  {a.submission.liveUrl ? (
                    <>
                      {" "}
                      ·{" "}
                      <a className="text-green-700 underline" href={a.submission.liveUrl} target="_blank" rel="noreferrer">
                        Live
                      </a>
                    </>
                  ) : null}
                </p>
                {(a.submission.feedbacks || []).map((f, i) => (
                  <p key={i} className="mt-2 border-t pt-2 text-xs text-slate-600">
                    Feedback ({f.reviewer?.fullName || "Reviewer"}): {f.comment}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const assignTab = (
    <>
      <form onSubmit={onStaffSubmit} className="mb-6 space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("assign")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "assign" ? "bg-green-600 text-white" : "border bg-white"}`}
          >
            Assign now
          </button>
          <button
            type="button"
            onClick={() => setMode("save")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "save" ? "bg-green-600 text-white" : "border bg-white"}`}
          >
            Save to library
          </button>
        </div>

        {mode === "assign" && libraryOptions.length > 0 && (
          <label className="block text-sm text-slate-600">
            From library (optional)
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
              value={libraryTaskId}
              onChange={(e) => setLibraryTaskId(e.target.value)}
            >
              <option value="">— New task (fill title below) —</option>
              {libraryOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.libraryOrder ?? "—"} · {t.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "assign" && alreadyAssignedWarn && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Already assigned</p>
            <p className="mt-0.5 text-xs">
              {alreadyAssignedWarn.message ||
                `${alreadyAssignedWarn.count} intern(s) already received this library task.`}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {alreadyAssignedWarn.names.slice(0, 8).join(", ")}
              {alreadyAssignedWarn.names.length > 8 ? ` +${alreadyAssignedWarn.names.length - 8} more` : ""}
            </p>
          </div>
        )}

        {!libraryTaskId && (
          <>
            <input
              className="w-full rounded-lg border px-3 py-2.5 text-sm"
              placeholder="Task title (e.g. Landing Page)"
              required={mode === "save" || !libraryTaskId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="w-full rounded-lg border px-3 py-2.5 text-sm"
              rows={3}
              placeholder="Description / requirements"
              required={mode === "save" || !libraryTaskId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {mode === "save" && (
              <label className="block text-sm text-slate-600">
                Library number (optional — 1st, 2nd, 3rd…)
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                  placeholder="Auto next number if empty"
                  value={saveLibOrder}
                  onChange={(e) => setSaveLibOrder(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        {mode === "assign" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-600">
              Assign for date
              <input
                type="date"
                required
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                value={forDate}
                onChange={(e) => setForDate(e.target.value)}
              />
            </label>
            <label className="text-sm text-slate-600">
              Group
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                required
              >
                <option value="">Select group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {mode === "assign" && !libraryTaskId && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={alsoSave} onChange={(e) => setAlsoSave(e.target.checked)} />
            Also save to library for reuse
          </label>
        )}

        <button className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm text-white sm:w-auto">
          {mode === "save" ? "Save to library" : libraryTaskId ? "Assign from library" : "Assign task"}
        </button>
        {formMsg && <p className="text-sm text-green-700">{formMsg}</p>}
        {formErr && <p className="text-sm text-red-600">{formErr}</p>}
      </form>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Task library</h3>
          <PageSizeSelect
            value={libLimit}
            onChange={(n) => {
              setLibLimit(n);
              setLibPage(1);
            }}
          />
        </div>
        <form onSubmit={applyLibSearch} className="mb-3 flex flex-wrap gap-2">
          <input
            className="min-w-[180px] flex-1 rounded-lg border px-3 py-2 text-sm"
            placeholder="Search library…"
            value={libSearch}
            onChange={(e) => setLibSearch(e.target.value)}
          />
          <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
            Search
          </button>
        </form>
        {library.length === 0 ? (
          <p className="text-sm text-slate-500">No saved tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {library.map((t) => {
              const open = !!expandedLib[t.id];
              const n = t.libraryOrder ?? "—";
              const count = t.assignmentCount ?? t._count?.assignments ?? 0;
              return (
                <li key={t.id} className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      onClick={() => setExpandedLib((m) => ({ ...m, [t.id]: !open }))}
                    >
                      <span className="text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        #{n}
                      </span>
                      <span className="truncate font-medium text-slate-900">{t.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{count} assigned</span>
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border px-2 py-1 text-xs"
                      onClick={() => {
                        setMode("assign");
                        setLibraryTaskId(t.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1 text-slate-600 hover:bg-slate-100"
                      title="Edit"
                      onClick={() => openLibEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1 text-red-600 hover:bg-red-50"
                      onClick={() => void deleteLibrary(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-2 border-t bg-slate-50 px-3 py-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700">{t.description}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Assigned to ({t.assignees?.length ?? 0} unique intern
                          {(t.assignees?.length ?? 0) === 1 ? "" : "s"})
                        </p>
                        {(t.assignees?.length ?? 0) === 0 ? (
                          <p className="mt-1 text-xs text-slate-500">Not assigned to anyone yet.</p>
                        ) : (
                          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-700">
                            {(t.assignees || []).map((a) => (
                              <li key={a.internId} className="flex flex-wrap justify-between gap-2 rounded bg-white px-2 py-1.5">
                                <span>
                                  <span className="font-medium">{a.fullName}</span>
                                  <span className="text-slate-400"> · {a.email}</span>
                                </span>
                                <span className="text-slate-500">
                                  {a.groupName || "—"} · {a.forDate}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pager pagination={libPagination} onChange={setLibPage} />
      </div>

      {editingLib && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveLibEdit} className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Edit library task</h3>
              <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={() => setEditingLib(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-xs text-slate-600">
              Number (#)
              <input
                type="number"
                min={1}
                required
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={editLibOrder}
                onChange={(e) => setEditLibOrder(e.target.value)}
              />
            </label>
            <input
              required
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={editLibTitle}
              onChange={(e) => setEditLibTitle(e.target.value)}
              placeholder="Title"
            />
            <textarea
              required
              rows={4}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={editLibDesc}
              onChange={(e) => setEditLibDesc(e.target.value)}
              placeholder="Description"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setEditingLib(null)}>
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );

  const batchDetailView =
    selectedBatch && (
      <div className="space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          onClick={() => {
            setSelectedBatch(null);
            setSelectedInternId(null);
          }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to tasks
        </button>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{selectedBatch.groupName}</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedBatch.displayLabel}</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{batchTaskDesc}</p>
              <p className="mt-2 text-xs text-slate-400">For date: {formatDate(selectedBatch.forDate)}</p>
            </div>
            <button
              type="button"
              disabled={exportingTasks}
              onClick={() => void exportBatchExcel()}
              className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {exportingTasks ? "Exporting…" : "Export Excel"}
            </button>
          </div>
          {showAudit && (
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
              <p>
                Assigned by:{" "}
                <span className="font-medium text-slate-800">
                  {personLabel(selectedBatch.assignedBy?.fullName, selectedBatch.assignedBy?.role)}
                </span>
                {selectedBatch.assignedAt ? ` · ${formatDate(selectedBatch.assignedAt)}` : ""}
              </p>
              {(selectedBatch.reviewers?.length ?? 0) > 0 && (
                <p className="mt-1">
                  Checked by:{" "}
                  <span className="font-medium text-slate-800">
                    {selectedBatch.reviewers!.map((r) => personLabel(r.fullName, r.role)).join(", ")}
                  </span>
                </p>
              )}
            </div>
          )}
          {batchCounts && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{batchInterns.length} interns</span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">Pending: {batchCounts.ASSIGNED}</span>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">Submitted: {batchCounts.SUBMITTED}</span>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Needs work: {batchCounts.NEEDS_IMPROVEMENT}</span>
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800">Done: {batchCounts.DONE}</span>
            </div>
          )}
        </div>

        {loadingBatch && <p className="text-xs text-slate-400">Loading interns…</p>}

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Interns — click one to see submission & review</p>
          {batchInterns.map((a) => {
            const open = selectedInternId === a.id;
            return (
              <div key={a.id} className={`rounded-xl border bg-white ${open ? "ring-2 ring-green-500/40" : ""}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 p-4 text-left"
                  onClick={() => setSelectedInternId(open ? null : a.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{a.intern?.user.fullName || "Intern"}</p>
                      <p className="text-xs text-slate-500">
                        {a.collegeName || a.intern?.user.email || ""}
                        {a.submittedAt ? ` · Submitted ${formatDate(a.submittedAt)}` : " · Not submitted"}
                      </p>
                      {showAudit && a.lastReview && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                          Checked by {personLabel(a.lastReview.by, a.lastReview.byRole)}: “{a.lastReview.comment}”
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge status={a.status} />
                </button>
                {open && renderInternDetail(a)}
              </div>
            );
          })}
          {!loadingBatch && batchInterns.length === 0 && (
            <p className="text-sm text-slate-500">No interns found for this task.</p>
          )}
        </div>
      </div>
    );

  const manageList = (
    <>
      {isIntern ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={exportingTasks}
              onClick={() => void exportTasksExcel()}
              className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {exportingTasks ? "Exporting…" : "Export Excel"}
            </button>
            <PageSizeSelect
              value={assignLimit}
              onChange={(n) => {
                setAssignLimit(n);
                setAssignPage(1);
              }}
            />
          </div>
          {loadingList && <p className="mb-2 text-xs text-slate-400">Loading…</p>}
          <div className="space-y-3">
            {assignments.map((a) => renderAssignmentCard(a))}
            {assignments.length === 0 && !loadingList && <p className="text-sm text-slate-500">No tasks yet.</p>}
            <Pager pagination={assignPagination} onChange={setAssignPage} />
          </div>
        </>
      ) : selectedBatch ? (
        batchDetailView
      ) : (
        <>
          <div className="mb-4 rounded-xl border bg-white p-4">
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                Total: {statusCounts.ASSIGNED + statusCounts.SUBMITTED + statusCounts.NEEDS_IMPROVEMENT + statusCounts.DONE}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">Assigned: {statusCounts.ASSIGNED}</span>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">Submitted: {statusCounts.SUBMITTED}</span>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Needs work: {statusCounts.NEEDS_IMPROVEMENT}</span>
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800">Done: {statusCounts.DONE}</span>
            </div>
            <form onSubmit={applySearch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">
                Status
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setOpenGroupId(null);
                    setBatches([]);
                    setGroupPage(1);
                  }}
                >
                  {STATUS_FILTERS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Group
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={groupFilter}
                  onChange={(e) => {
                    setGroupFilter(e.target.value);
                    setOpenGroupId(null);
                    setBatches([]);
                    setGroupPage(1);
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
              {showAudit && (
                <label className="text-xs font-medium text-slate-600">
                  Assigned by
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={assignedByFilter}
                    onChange={(e) => {
                      setAssignedByFilter(e.target.value);
                      setOpenGroupId(null);
                      setBatches([]);
                      setGroupPage(1);
                    }}
                    disabled={assigners.length === 0}
                  >
                    <option value="all">{assigners.length ? "Anyone" : "No assigners yet"}</option>
                    {assigners.map((a) => (
                      <option key={a.id} value={a.id}>
                        {personLabel(a.fullName, a.role)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {showAudit && (
                <label className="text-xs font-medium text-slate-600">
                  Checked by
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={reviewedByFilter}
                    onChange={(e) => {
                      setReviewedByFilter(e.target.value);
                      setOpenGroupId(null);
                      setBatches([]);
                      setGroupPage(1);
                    }}
                    disabled={reviewers.length === 0}
                  >
                    <option value="all">{reviewers.length ? "Anyone" : "No reviews yet"}</option>
                    {reviewers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {personLabel(r.fullName, r.role)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-xs font-medium text-slate-600">
                Search name / task
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Intern or task title…"
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
                  Apply
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-4 py-2 text-sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setGroupFilter("all");
                    setAssignedByFilter("all");
                    setReviewedByFilter("all");
                    setSearch("");
                    setOpenGroupId(null);
                    setBatches([]);
                    setGroupPage(1);
                    void loadActors();
                    void loadGroupSummaries({ search: "" });
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={exportingTasks}
                  onClick={() => void exportTasksExcel()}
                  className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {exportingTasks ? "Exporting…" : "Export Excel"}
                </button>
              </div>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Open one group at a time. Export = current filters ke saare assignments (page limit nahi). Assigned by / Checked by only list people in your scope.
            </p>
          </div>

          {loadingList && !openGroupId && <p className="mb-2 text-xs text-slate-400">Loading…</p>}

          <div className="space-y-3">
            {groupSummaries.map((g) => {
              const isOpen = openGroupId === g.groupId;
              return (
                <section key={g.groupId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left"
                    onClick={() => void toggleGroup(g.groupId)}
                  >
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{g.groupName}</h2>
                      <p className="text-xs text-slate-500">
                        {g.taskCount} task{g.taskCount === 1 ? "" : "s"} · {g.internAssignments} assignments
                        {" · "}
                        Done {g.counts.DONE} · Submitted {g.counts.SUBMITTED} · Pending {g.counts.ASSIGNED}
                      </p>
                    </div>
                    {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t p-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">Tasks in this group</p>
                        {groupPagination.total > 10 && (
                          <PageSizeSelect
                            value={groupLimit}
                            onChange={(n) => {
                              setGroupLimit(n);
                              setGroupPage(1);
                            }}
                          />
                        )}
                      </div>

                      {loadingList && <p className="text-xs text-slate-400">Loading tasks…</p>}

                      {batches.map((b) => (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() => void openBatch(b)}
                          className="flex w-full items-start justify-between gap-3 rounded-xl border bg-white p-4 text-left hover:border-green-300 hover:bg-green-50/40"
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <div className="min-w-0">
                              <h3 className="font-semibold text-slate-900">{b.displayLabel}</h3>
                              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{b.description}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {b.total} intern{b.total === 1 ? "" : "s"} · {formatDate(b.forDate)}
                                {" · "}
                                Done {b.counts.DONE} · Submitted {b.counts.SUBMITTED} · Pending {b.counts.ASSIGNED}
                                {b.counts.NEEDS_IMPROVEMENT ? ` · Needs work ${b.counts.NEEDS_IMPROVEMENT}` : ""}
                              </p>
                              {showAudit && (
                                <p className="mt-1 text-xs text-slate-600">
                                  Assigned by{" "}
                                  <span className="font-medium">{personLabel(b.assignedBy?.fullName, b.assignedBy?.role)}</span>
                                  {b.assignedAt ? ` · ${formatDate(b.assignedAt)}` : ""}
                                  {(b.reviewers?.length ?? 0) > 0
                                    ? ` · Checked by ${b.reviewers!.map((r) => personLabel(r.fullName, r.role)).join(", ")}`
                                    : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}

                      {!loadingList && batches.length === 0 && (
                        <p className="text-sm text-slate-500">No tasks in this group for current filters.</p>
                      )}

                      {groupPagination.total > groupLimit && (
                        <Pager
                          pagination={groupPagination}
                          onChange={(p) => {
                            setGroupPage(p);
                          }}
                        />
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {groupSummaries.length === 0 && !loadingList && (
              <p className="text-sm text-slate-500">No groups match these filters.</p>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div>
      <PageHeader
        title={isIntern ? "My Tasks" : "Tasks"}
        subtitle={
          isIntern
            ? "Tap a task for details. Use Mark Task to submit."
            : "Open a task → see all interns → review submission links"
        }
      />

      {canAssign && (
        <div className="mb-5 flex gap-1 rounded-xl border bg-white p-1">
          <button
            type="button"
            onClick={() => {
              setStaffTab("assign");
              setSelectedBatch(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              staffTab === "assign" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Assign & Library
          </button>
          <button
            type="button"
            onClick={() => setStaffTab("manage")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              staffTab === "manage" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Manage assignments
          </button>
        </div>
      )}

      {canAssign && staffTab === "assign" && assignTab}
      {(isIntern || !canAssign || staffTab === "manage") && manageList}

      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form onSubmit={saveTaskEdit} className="w-full rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit task</h2>
              <button type="button" onClick={() => setEditingTask(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <textarea className="mb-4 w-full rounded-lg border px-3 py-2.5 text-sm" rows={4} required value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            <button type="submit" className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white">
              Save
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
