import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../../api/client";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../auth/AuthContext";

type InternUser = {
  id: string;
  fullName: string;
  email: string;
  internProfile?: { id: string; college?: { name: string } | null } | null;
};

type Group = {
  id: string;
  name: string;
  batchLabel?: string | null;
  trainerId?: string | null;
  trainer?: { id?: string; fullName: string } | null;
  members: {
    internId: string;
    intern: { id: string; user: { fullName: string; email: string }; college?: { name: string } | null };
  }[];
};

export function GroupsPage({ basePath }: { basePath: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const [groups, setGroups] = useState<Group[]>([]);
  const [interns, setInterns] = useState<InternUser[]>([]);
  const [trainers, setTrainers] = useState<{ id: string; fullName: string }[]>([]);
  const [name, setName] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [selectedInterns, setSelectedInterns] = useState<string[]>([]);
  const [editing, setEditing] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editBatch, setEditBatch] = useState("");
  const [editTrainerId, setEditTrainerId] = useState("");
  const [addingTo, setAddingTo] = useState<Group | null>(null);
  const [addSelected, setAddSelected] = useState<string[]>([]);
  const [addMsg, setAddMsg] = useState("");

  async function load() {
    const g = await api.get("/groups");
    setGroups(g.data.groups);
    if (canEdit) {
      const u = await api.get("/users?role=INTERN");
      setInterns(u.data.users);
      if (user?.role === "HR" || user?.role === "ADMIN") {
        const t = await api.get("/users?role=TRAINER");
        setTrainers(t.data.users);
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleIntern(internProfileId: string) {
    setSelectedInterns((prev) =>
      prev.includes(internProfileId) ? prev.filter((id) => id !== internProfileId) : [...prev, internProfileId],
    );
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api.post("/groups", {
      name,
      batchLabel: batchLabel || undefined,
      trainerId: user?.role === "HR" || user?.role === "ADMIN" ? trainerId || undefined : undefined,
      internIds: selectedInterns,
    });
    setName("");
    setBatchLabel("");
    setSelectedInterns([]);
    await load();
  }

  function openEdit(g: Group) {
    setEditing(g);
    setEditName(g.name);
    setEditBatch(g.batchLabel || "");
    setEditTrainerId(g.trainerId || g.trainer?.id || "");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await api.patch(`/groups/${editing.id}`, {
      name: editName,
      batchLabel: editBatch || null,
      ...(user?.role === "HR" || user?.role === "ADMIN" ? { trainerId: editTrainerId || null } : {}),
    });
    setEditing(null);
    await load();
  }

  async function onDelete(g: Group) {
    if (!confirm(`Delete group “${g.name}”? Members will be unassigned from this group.`)) return;
    await api.delete(`/groups/${g.id}`);
    await load();
  }

  function openAddMembers(g: Group) {
    setAddingTo(g);
    setAddSelected([]);
    setAddMsg("");
  }

  function availableInternsFor(g: Group) {
    const memberIds = new Set((g.members || []).map((m) => m.internId));
    return interns.filter((i) => i.internProfile?.id && !memberIds.has(i.internProfile.id));
  }

  async function onAddMembers(e: FormEvent) {
    e.preventDefault();
    if (!addingTo || addSelected.length === 0) return;
    try {
      await api.post(`/groups/${addingTo.id}/members`, { internIds: addSelected });
      setAddMsg("Interns added");
      setAddingTo(null);
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setAddMsg(ax.response?.data?.message || "Failed to add");
    }
  }

  return (
    <div>
      <PageHeader title="Training Groups" subtitle="Same-college split or cross-college mix" />
      {canEdit && (
        <form onSubmit={onCreate} className="mb-6 space-y-3 rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="rounded-lg border px-3 py-2.5 text-sm"
              placeholder="Group name"
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
            <p className="mb-2 text-sm font-medium text-slate-700">Add interns</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2">
              {interns.map((i) => {
                const pid = i.internProfile?.id;
                if (!pid) return null;
                return (
                  <label key={i.id} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={selectedInterns.includes(pid)} onChange={() => toggleIntern(pid)} />
                    {i.fullName} <span className="text-slate-400">({i.internProfile?.college?.name || "—"})</span>
                  </label>
                );
              })}
            </div>
          </div>
          <button className="rounded-lg bg-green-600 px-4 py-2.5 text-sm text-white">Create group</button>
        </form>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id} className="rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{g.name}</h3>
                <p className="text-xs text-slate-500">
                  {g.batchLabel || "No batch"} · Trainer: {g.trainer?.fullName || "—"} · {g.members?.length || 0}{" "}
                  members
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => openAddMembers(g)} className="rounded-lg p-2 text-green-700 hover:bg-green-50" aria-label="Add interns" title="Add interns">
                    <UserPlus className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => openEdit(g)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => void onDelete(g)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <ul className="mt-3 divide-y text-sm">
              {(g.members || []).map((m) => (
                <li key={m.internId} className="flex justify-between py-2">
                  <span>{m.intern.user.fullName}</span>
                  <span className="text-slate-400">{m.intern.college?.name || "—"}</span>
                </li>
              ))}
            </ul>
            {canEdit && (
              <button
                type="button"
                onClick={() => openAddMembers(g)}
                className="mt-3 w-full rounded-lg border border-dashed border-green-300 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
              >
                + Add interns to this group
              </button>
            )}
          </div>
        ))}
        {groups.length === 0 && <p className="text-sm text-slate-500">No groups yet.</p>}
      </div>

      {addingTo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form onSubmit={onAddMembers} className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add to {addingTo.name}</h2>
              <button type="button" onClick={() => setAddingTo(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4 max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
              {availableInternsFor(addingTo).map((i) => {
                const pid = i.internProfile!.id;
                return (
                  <label key={i.id} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={addSelected.includes(pid)}
                      onChange={() =>
                        setAddSelected((prev) =>
                          prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid],
                        )
                      }
                    />
                    {i.fullName}
                    <span className="text-slate-400">({i.internProfile?.college?.name || "—"})</span>
                  </label>
                );
              })}
              {availableInternsFor(addingTo).length === 0 && (
                <p className="p-2 text-sm text-slate-500">All interns are already in this group (or none left).</p>
              )}
            </div>
            {addMsg && <p className="mb-2 text-sm text-red-600">{addMsg}</p>}
            <button
              type="submit"
              disabled={addSelected.length === 0}
              className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
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
            <input className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm" required value={editName} onChange={(e) => setEditName(e.target.value)} />
            <input className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm" value={editBatch} onChange={(e) => setEditBatch(e.target.value)} placeholder="Batch label" />
            {(user?.role === "HR" || user?.role === "ADMIN") && (
              <select className="mb-4 w-full rounded-lg border px-3 py-2.5 text-sm" value={editTrainerId} onChange={(e) => setEditTrainerId(e.target.value)}>
                <option value="">No trainer</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            )}
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
