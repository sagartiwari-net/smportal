import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../auth/AuthContext";
import { AnalyticsDrillPanel, type DrillFrame } from "./analytics/AnalyticsDrillPanel";

type College = { id: string; name: string; code?: string | null };

export function CollegesPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";

  const [colleges, setColleges] = useState<College[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState<College | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [drill, setDrill] = useState<DrillFrame[]>([]);
  const currentDrill = drill[drill.length - 1] ?? null;

  function pushDrill(frame: DrillFrame) {
    setDrill((d) => [...d, frame]);
  }
  function popDrill() {
    setDrill((d) => d.slice(0, -1));
  }
  function openCollege(collegeName: string) {
    pushDrill({ kind: "college", name: collegeName });
  }
  function openGroup(groupName: string) {
    pushDrill({ kind: "group", name: groupName });
  }
  function openIntern(internId: string, label?: string) {
    pushDrill({ kind: "intern", internId, label });
  }

  async function load() {
    const { data } = await api.get("/colleges");
    setColleges(data.colleges);
  }
  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/colleges", { name, code: code || undefined });
      setName("");
      setCode("");
      setMsg("College added");
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Failed");
    }
  }

  function openEdit(c: College) {
    setEditing(c);
    setEditName(c.name);
    setEditCode(c.code || "");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api.patch(`/colleges/${editing.id}`, { name: editName, code: editCode || null });
      setEditing(null);
      setMsg("College updated");
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Update failed");
    }
  }

  async function onDelete(c: College) {
    if (!confirm(`Delete ${c.name}?`)) return;
    try {
      await api.delete(`/colleges/${c.id}`);
      setMsg("College deleted");
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Delete failed");
    }
  }

  if (currentDrill) {
    return (
      <div>
        <PageHeader title="Colleges" subtitle="College analytics drill-down" />
        <AnalyticsDrillPanel
          frame={currentDrill}
          filterQuery=""
          onBack={popDrill}
          onOpenCollege={openCollege}
          onOpenGroup={openGroup}
          onOpenIntern={openIntern}
          onOpenDay={(date) => pushDrill({ kind: "day", date })}
          canManageIntern={canManage}
          canManageGroup={canManage}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Colleges" subtitle="Add, edit, or remove colleges · click a name for full details" />
      <form onSubmit={onSubmit} className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <input className="flex-1 rounded-lg border px-3 py-2.5 text-sm" placeholder="College name" required value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded-lg border px-3 py-2.5 text-sm sm:w-40" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="rounded-lg bg-green-600 px-4 py-2.5 text-sm text-white">Add college</button>
      </form>
      {msg && <p className="mb-3 text-sm text-green-700">{msg}</p>}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      <ul className="space-y-2">
        {colleges.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-sm">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => openCollege(c.name)}
                className="font-medium text-green-800 underline-offset-2 hover:underline"
              >
                {c.name}
              </button>
              {c.code ? <span className="ml-2 text-slate-500">({c.code})</span> : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => openEdit(c)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => void onDelete(c)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form onSubmit={onSave} className="w-full rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit college</h2>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm" required value={editName} onChange={(e) => setEditName(e.target.value)} />
            <input className="mb-4 w-full rounded-lg border px-3 py-2.5 text-sm" value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="Code" />
            <button type="submit" className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white">Save</button>
          </form>
        </div>
      )}
    </div>
  );
}
