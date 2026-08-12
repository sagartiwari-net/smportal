import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../../api/client";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../auth/AuthContext";
import {
  AnalyticsDrillPanel,
  type DrillFrame,
} from "./analytics/AnalyticsDrillPanel";

type OtherGroup = { id: string; name: string };

type AvailableIntern = {
  internId: string;
  fullName: string;
  email: string;
  otherGroups: OtherGroup[];
};

type CollegeBucket = {
  id: string;
  name: string;
  interns: AvailableIntern[];
};

type Group = {
  id: string;
  name: string;
  batchLabel?: string | null;
  trainerId?: string | null;
  internshipStatus?: string;
  trainer?: { id?: string; fullName: string } | null;
  members: {
    internId: string;
    intern: {
      id: string;
      user: { fullName: string; email: string };
      college?: { name: string } | null;
    };
  }[];
};

function InternPicker({
  colleges,
  noCollege,
  selected,
  onToggle,
  search,
  onSearchChange,
  loading,
  onOpenIntern,
  onOpenCollege,
  onOpenGroup,
}: {
  colleges: CollegeBucket[];
  noCollege: AvailableIntern[];
  selected: string[];
  onToggle: (internId: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  loading?: boolean;
  onOpenIntern?: (internId: string, label: string) => void;
  onOpenCollege?: (name: string) => void;
  onOpenGroup?: (name: string) => void;
}) {
  // Default collapsed — open only when user clicks
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderIntern(i: AvailableIntern) {
    const inOther = i.otherGroups.length > 0;
    return (
      <div key={i.internId} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected.includes(i.internId)}
          onChange={() => onToggle(i.internId)}
        />
        <span className="min-w-0">
          {onOpenIntern ? (
            <button
              type="button"
              className="font-medium text-green-800 underline-offset-2 hover:underline"
              onClick={() => onOpenIntern(i.internId, i.fullName)}
            >
              {i.fullName}
            </button>
          ) : (
            <span className="font-medium text-slate-900">{i.fullName}</span>
          )}
          <span className="block text-xs text-slate-400">{i.email}</span>
          {inOther && (
            <span className="mt-0.5 block text-xs text-amber-700">
              Already in:{" "}
              {i.otherGroups.map((g, idx) => (
                <span key={g.id}>
                  {idx > 0 ? ", " : ""}
                  {onOpenGroup ? (
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => onOpenGroup(g.name)}
                    >
                      {g.name}
                    </button>
                  ) : (
                    g.name
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
    );
  }

  const sections: { key: string; title: string; count: number; interns: AvailableIntern[]; collegeName?: string }[] = [
    ...colleges.map((c) => ({
      key: `c:${c.id}`,
      title: c.name,
      count: c.interns.length,
      interns: c.interns,
      collegeName: c.name,
    })),
  ];
  if (noCollege.length > 0) {
    sections.push({
      key: "none",
      title: "No college (direct / manual)",
      count: noCollege.length,
      interns: noCollege,
    });
  }

  return (
    <div className="space-y-2">
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm"
        placeholder="Search name or email…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {loading ? (
        <p className="text-sm text-slate-500">Loading interns…</p>
      ) : sections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-slate-500">No available interns for this list.</p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2">
          {sections.map((sec) => {
            const open = openKeys.has(sec.key);
            return (
              <div key={sec.key} className="overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => toggleOpen(sec.key)}
                  className="flex w-full items-center justify-between bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-slate-400">{open ? "▾" : "▸"}</span>{" "}
                    {sec.collegeName && onOpenCollege ? (
                      <span
                        role="link"
                        tabIndex={0}
                        className="text-green-800 underline-offset-2 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCollege(sec.collegeName!);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            onOpenCollege(sec.collegeName!);
                          }
                        }}
                      >
                        {sec.title}
                      </span>
                    ) : (
                      sec.title
                    )}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">{sec.count}</span>
                </button>
                {open && <div className="divide-y border-t bg-white">{sec.interns.map(renderIntern)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {selected.length > 0 && <p className="text-xs text-slate-500">{selected.length} selected</p>}
    </div>
  );
}

export function GroupsPage({ basePath }: { basePath: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const [tab, setTab] = useState<"groups" | "create">(canEdit ? "groups" : "groups");

  const [groups, setGroups] = useState<Group[]>([]);
  const [trainers, setTrainers] = useState<{ id: string; fullName: string }[]>([]);
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "COMPLETED">("all");
  const [memberSearch, setMemberSearch] = useState("");

  const [name, setName] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [selectedInterns, setSelectedInterns] = useState<string[]>([]);
  const [createMsg, setCreateMsg] = useState("");
  const [createErr, setCreateErr] = useState("");

  const [createColleges, setCreateColleges] = useState<CollegeBucket[]>([]);
  const [createNoCollege, setCreateNoCollege] = useState<AvailableIntern[]>([]);
  const [createSearch, setCreateSearch] = useState("");
  const [createPoolLoading, setCreatePoolLoading] = useState(false);

  const [editing, setEditing] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editBatch, setEditBatch] = useState("");
  const [editTrainerId, setEditTrainerId] = useState("");
  const [editErr, setEditErr] = useState("");

  const [addingTo, setAddingTo] = useState<Group | null>(null);
  const [addSelected, setAddSelected] = useState<string[]>([]);
  const [addMsg, setAddMsg] = useState("");
  const [addColleges, setAddColleges] = useState<CollegeBucket[]>([]);
  const [addNoCollege, setAddNoCollege] = useState<AvailableIntern[]>([]);
  const [addSearch, setAddSearch] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [drill, setDrill] = useState<DrillFrame[]>([]);
  const currentDrill = drill[drill.length - 1] ?? null;

  function pushDrill(frame: DrillFrame) {
    setDrill((d) => [...d, frame]);
  }
  function popDrill() {
    setDrill((d) => d.slice(0, -1));
  }
  function openIntern(internId: string, label?: string) {
    pushDrill({ kind: "intern", internId, label });
  }
  function openCollege(collegeName: string) {
    pushDrill({ kind: "college", name: collegeName });
  }
  function openGroup(groupName: string) {
    pushDrill({ kind: "group", name: groupName });
  }

  async function loadGroups() {
    const g = await api.get("/groups");
    setGroups(g.data.groups);
    if (canEdit && (user?.role === "HR" || user?.role === "ADMIN")) {
      const t = await api.get("/users?role=TRAINER");
      setTrainers(t.data.users);
    }
  }

  const loadCreatePool = useCallback(
    async (q = "") => {
      if (!canEdit) return;
      setCreatePoolLoading(true);
      try {
        const { data } = await api.get("/groups/available-interns", {
          params: q.trim() ? { q: q.trim() } : undefined,
        });
        setCreateColleges(data.colleges || []);
        setCreateNoCollege(data.noCollege || []);
      } finally {
        setCreatePoolLoading(false);
      }
    },
    [canEdit],
  );

  const loadAddPool = useCallback(async (groupId: string, q = "") => {
    setAddLoading(true);
    try {
      const { data } = await api.get("/groups/available-interns", {
        params: {
          excludeGroupId: groupId,
          ...(q.trim() ? { q: q.trim() } : {}),
        },
      });
      setAddColleges(data.colleges || []);
      setAddNoCollege(data.noCollege || []);
    } finally {
      setAddLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    if (canEdit && tab === "create") void loadCreatePool();
  }, [canEdit, tab, loadCreatePool]);

  function toggleCreate(internId: string) {
    setSelectedInterns((prev) =>
      prev.includes(internId) ? prev.filter((id) => id !== internId) : [...prev, internId],
    );
  }

  function toggleGroupOpen(id: string) {
    setOpenGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateMsg("");
    setCreateErr("");
    try {
      await api.post("/groups", {
        name,
        batchLabel: batchLabel || undefined,
        trainerId: user?.role === "HR" || user?.role === "ADMIN" ? trainerId || undefined : undefined,
        internIds: selectedInterns,
      });
      setCreateMsg("Group created");
      setName("");
      setBatchLabel("");
      setSelectedInterns([]);
      await loadGroups();
      await loadCreatePool(createSearch);
      setTab("groups");
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setCreateErr(ax.response?.data?.message || "Could not create group");
    }
  }

  function openEdit(g: Group) {
    setEditing(g);
    setEditName(g.name);
    setEditBatch(g.batchLabel || "");
    setEditTrainerId(g.trainerId || g.trainer?.id || "");
    setEditErr("");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditErr("");
    try {
      await api.patch(`/groups/${editing.id}`, {
        name: editName,
        batchLabel: editBatch || null,
        ...(user?.role === "HR" || user?.role === "ADMIN" ? { trainerId: editTrainerId || null } : {}),
      });
      setEditing(null);
      await loadGroups();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setEditErr(ax.response?.data?.message || "Could not save");
    }
  }

  async function onDelete(g: Group) {
    if (!confirm(`Delete group “${g.name}”? Members will be unassigned from this group.`)) return;
    await api.delete(`/groups/${g.id}`);
    await loadGroups();
    await loadCreatePool(createSearch);
  }

  async function toggleComplete(g: Group) {
    const next = g.internshipStatus === "COMPLETED" ? "ACTIVE" : "COMPLETED";
    const msg =
      next === "COMPLETED"
        ? `Mark “${g.name}” internship COMPLETED? Members will be completed and attendance will lock.`
        : `Reopen “${g.name}” internship?`;
    if (!confirm(msg)) return;
    await api.patch(`/groups/${g.id}/complete`, { internshipStatus: next });
    await loadGroups();
  }

  function openAddMembers(g: Group) {
    setAddingTo(g);
    setAddSelected([]);
    setAddMsg("");
    setAddSearch("");
    void loadAddPool(g.id);
  }

  async function onAddMembers(e: FormEvent) {
    e.preventDefault();
    if (!addingTo || addSelected.length === 0) return;
    try {
      const { data } = await api.post(`/groups/${addingTo.id}/members`, { internIds: addSelected });
      setAddingTo(null);
      await loadGroups();
      await loadCreatePool(createSearch);
      const n = data?.tasksAssigned ?? 0;
      const found = data?.groupTasksFound ?? 0;
      if (found === 0) {
        alert("Members added. No group-wide tasks found for this group yet.");
      } else if (n > 0) {
        alert(`Members added. ${n} task assignment(s) copied from ${found} group task(s).`);
      } else {
        alert(`Members added. They already had all ${found} group task(s).`);
      }
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setAddMsg(ax.response?.data?.message || "Failed to add");
    }
  }

  async function syncGroupTasks(g: Group) {
    if (!confirm(`Sync existing tasks of “${g.name}” to all current members?\n(Useful after adding members who missed auto-assign.)`)) {
      return;
    }
    try {
      const { data } = await api.post(`/groups/${g.id}/sync-tasks`);
      alert(
        `Synced: ${data?.tasksAssigned ?? 0} new assignment(s), ${data?.submissionsSynced ?? 0} submission(s) copied.`,
      );
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      alert(ax.response?.data?.message || "Sync failed");
    }
  }

  const createSearchDebounced = useMemo(() => createSearch, [createSearch]);
  useEffect(() => {
    if (!canEdit || tab !== "create") return;
    const t = setTimeout(() => void loadCreatePool(createSearchDebounced), 250);
    return () => clearTimeout(t);
  }, [createSearchDebounced, canEdit, tab, loadCreatePool]);

  useEffect(() => {
    if (!addingTo) return;
    const t = setTimeout(() => void loadAddPool(addingTo.id, addSearch), 250);
    return () => clearTimeout(t);
  }, [addSearch, addingTo, loadAddPool]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    const mq = memberSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (statusFilter !== "all" && (g.internshipStatus || "ACTIVE") !== statusFilter) return false;
      if (q) {
        const hay = `${g.name} ${g.batchLabel || ""} ${g.trainer?.fullName || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (mq) {
        const hit = (g.members || []).some((m) => {
          const s = `${m.intern.user.fullName} ${m.intern.user.email} ${m.intern.college?.name || ""}`.toLowerCase();
          return s.includes(mq);
        });
        if (!hit) return false;
      }
      return true;
    });
  }, [groups, groupSearch, memberSearch, statusFilter]);

  if (currentDrill) {
    return (
      <div>
        <PageHeader title="Training Groups" subtitle="Drill-down details (same as Analytics)" />
        <AnalyticsDrillPanel
          frame={currentDrill}
          filterQuery=""
          onBack={popDrill}
          onOpenCollege={openCollege}
          onOpenGroup={openGroup}
          onOpenIntern={openIntern}
          onOpenDay={(date) => pushDrill({ kind: "day", date })}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Training Groups"
        subtitle="Collapsed lists · click name / college / group to open details"
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("groups")}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
            tab === "groups" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Groups ({groups.length})
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              tab === "create" ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Create group
          </button>
        )}
      </div>

      {tab === "create" && canEdit && (
        <form onSubmit={onCreate} className="mb-6 space-y-3 rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="rounded-lg border px-3 py-2.5 text-sm"
              placeholder="Group name (must be unique)"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="rounded-lg border px-3 py-2.5 text-sm"
              placeholder="Batch label"
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
            />
            {(user?.role === "HR" || user?.role === "ADMIN") && (
              <select
                className="rounded-lg border px-3 py-2.5 text-sm"
                value={trainerId}
                onChange={(e) => setTrainerId(e.target.value)}
              >
                <option value="">Assign trainer (optional)</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Add interns (college-wise · collapsed · click names for details)
            </p>
            <InternPicker
              colleges={createColleges}
              noCollege={createNoCollege}
              selected={selectedInterns}
              onToggle={toggleCreate}
              search={createSearch}
              onSearchChange={setCreateSearch}
              loading={createPoolLoading}
              onOpenIntern={openIntern}
              onOpenCollege={openCollege}
              onOpenGroup={openGroup}
            />
          </div>
          {createMsg && <p className="text-sm text-green-700">{createMsg}</p>}
          {createErr && <p className="text-sm text-rose-600">{createErr}</p>}
          <button className="rounded-lg bg-green-600 px-4 py-2.5 text-sm text-white">Create group</button>
        </form>
      )}

      {tab === "groups" && (
        <div className="space-y-3">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className="rounded-lg border px-3 py-2 text-sm"
                placeholder="Search groups / trainer / batch…"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
              />
              <input
                className="rounded-lg border px-3 py-2 text-sm"
                placeholder="Filter by student name / email / college…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
              <select
                className="rounded-lg border px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="ACTIVE">Active only</option>
                <option value="COMPLETED">Completed only</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Groups stay collapsed by default. Click header to expand members · click student / college / group name for
              analytics-style details.
            </p>
          </div>

          {filteredGroups.map((g) => {
            const open = openGroupIds.has(g.id);
            const mq = memberSearch.trim().toLowerCase();
            const members = (g.members || []).filter((m) => {
              if (!mq) return true;
              const s = `${m.intern.user.fullName} ${m.intern.user.email} ${m.intern.college?.name || ""}`.toLowerCase();
              return s.includes(mq);
            });
            return (
              <div key={g.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                <div className="flex items-start gap-2 p-3 sm:p-4">
                  <button
                    type="button"
                    onClick={() => toggleGroupOpen(g.id)}
                    className="mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100"
                    aria-label={open ? "Collapse" : "Expand"}
                  >
                    {open ? "▾" : "▸"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="text-left text-base font-semibold text-green-800 underline-offset-2 hover:underline"
                      onClick={() => openGroup(g.name)}
                    >
                      {g.name}
                    </button>
                    <p className="text-xs text-slate-500">
                      {g.batchLabel || "No batch"} · Trainer: {g.trainer?.fullName || "—"} · {g.members?.length || 0}{" "}
                      members
                      {g.internshipStatus === "COMPLETED" ? " · Internship completed" : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => void toggleComplete(g)}
                        className="rounded-lg border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {g.internshipStatus === "COMPLETED" ? "Reopen" : "Complete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void syncGroupTasks(g)}
                        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                        title="Sync existing group tasks to all members"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddMembers(g)}
                        className="rounded-lg p-2 text-green-700 hover:bg-green-50"
                        title="Add interns"
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(g)}
                        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(g)}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {open && (
                  <div className="border-t">
                    <ul className="divide-y text-sm">
                      {members.map((m) => (
                        <li key={m.internId} className="flex justify-between gap-2 px-4 py-2.5">
                          <span className="min-w-0">
                            <button
                              type="button"
                              className="font-medium text-green-800 underline-offset-2 hover:underline"
                              onClick={() => openIntern(m.intern.id, m.intern.user.fullName)}
                            >
                              {m.intern.user.fullName}
                            </button>
                            <span className="block text-xs text-slate-400">{m.intern.user.email}</span>
                          </span>
                          {m.intern.college?.name ? (
                            <button
                              type="button"
                              className="shrink-0 text-xs text-green-800 underline-offset-2 hover:underline"
                              onClick={() => openCollege(m.intern.college!.name)}
                            >
                              {m.intern.college.name}
                            </button>
                          ) : (
                            <span className="shrink-0 text-xs text-slate-400">No college</span>
                          )}
                        </li>
                      ))}
                      {members.length === 0 && (
                        <li className="px-4 py-3 text-sm text-slate-500">No members match this filter.</li>
                      )}
                    </ul>
                    {canEdit && (
                      <div className="border-t p-3">
                        <button
                          type="button"
                          onClick={() => openAddMembers(g)}
                          className="w-full rounded-lg border border-dashed border-green-300 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                        >
                          + Add interns to this group
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredGroups.length === 0 && (
            <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No groups match your filters.</p>
          )}
        </div>
      )}

      {addingTo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form
            onSubmit={onAddMembers}
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Add to{" "}
                <button type="button" className="text-green-800 underline" onClick={() => openGroup(addingTo.name)}>
                  {addingTo.name}
                </button>
              </h2>
              <button type="button" onClick={() => setAddingTo(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Colleges collapsed by default. Click student / college / group names for details.
            </p>
            <InternPicker
              colleges={addColleges}
              noCollege={addNoCollege}
              selected={addSelected}
              onToggle={(id) =>
                setAddSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              }
              search={addSearch}
              onSearchChange={setAddSearch}
              loading={addLoading}
              onOpenIntern={openIntern}
              onOpenCollege={openCollege}
              onOpenGroup={openGroup}
            />
            {addMsg && <p className="mb-2 mt-2 text-sm text-red-600">{addMsg}</p>}
            <button
              type="submit"
              disabled={addSelected.length === 0}
              className="mt-4 w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Add selected ({addSelected.length})
            </button>
          </form>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form onSubmit={onSave} className="w-full rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit group</h2>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Group name (unique)"
            />
            <input
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm"
              value={editBatch}
              onChange={(e) => setEditBatch(e.target.value)}
              placeholder="Batch label"
            />
            {(user?.role === "HR" || user?.role === "ADMIN") && (
              <select
                className="mb-4 w-full rounded-lg border px-3 py-2.5 text-sm"
                value={editTrainerId}
                onChange={(e) => setEditTrainerId(e.target.value)}
              >
                <option value="">No trainer</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            )}
            {editErr && <p className="mb-2 text-sm text-rose-600">{editErr}</p>}
            <button type="submit" className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white">
              Save
            </button>
          </form>
        </div>
      )}
      <p className="sr-only">{basePath}</p>
    </div>
  );
}
