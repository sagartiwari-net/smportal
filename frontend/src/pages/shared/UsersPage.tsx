import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

type College = { id: string; name: string };
type UserRow = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  internProfile?: { id?: string; collegeId?: string | null; college?: { name: string } | null; phone?: string | null } | null;
  trainerProfile?: { phone?: string | null } | null;
  collegeProfile?: { collegeId?: string; college?: { name: string } | null; phone?: string | null } | null;
};

const emptyForm = {
  email: "",
  fullName: "",
  password: "password123",
  role: "INTERN",
  phone: "",
  collegeId: "",
};

export function UsersPage() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  const [users, setUsers] = useState<UserRow[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", password: "", phone: "", collegeId: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const [u, c] = await Promise.all([api.get("/users"), api.get("/colleges")]);
    setUsers(u.data.users);
    setColleges(c.data.colleges);
    if (c.data.colleges[0] && !form.collegeId) {
      setForm((f) => ({ ...f, collegeId: c.data.colleges[0].id }));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function roleOptions() {
    if (isAdmin) {
      return (
        <>
          <option value="ADMIN">Trusted Admin</option>
          <option value="HR">HR</option>
          <option value="TRAINER">Trainer</option>
          <option value="INTERN">Intern</option>
          <option value="COLLEGE">College</option>
        </>
      );
    }
    return (
      <>
        <option value="INTERN">Intern</option>
        <option value="TRAINER">Trainer</option>
        <option value="COLLEGE">College</option>
        <option value="HR">HR</option>
      </>
    );
  }

  function canDelete(u: UserRow) {
    if (u.id === me?.id) return false;
    if (isAdmin) return true;
    return u.role === "INTERN" || u.role === "TRAINER" || u.role === "COLLEGE";
  }

  function canEdit(u: UserRow) {
    if (isAdmin) return true;
    return u.role !== "ADMIN";
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    try {
      await api.post("/users", form);
      setMsg("User created");
      setForm((f) => ({ ...f, email: "", fullName: "", phone: "" }));
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Failed");
    }
  }

  function openEdit(u: UserRow) {
    setEditing(u);
    setEditForm({
      fullName: u.fullName,
      email: u.email,
      password: "",
      phone: u.internProfile?.phone || u.trainerProfile?.phone || u.collegeProfile?.phone || "",
      collegeId: u.internProfile?.collegeId || u.collegeProfile?.collegeId || "",
    });
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setErr("");
    try {
      await api.patch(`/users/${editing.id}`, {
        fullName: editForm.fullName,
        email: editForm.email,
        ...(editForm.password ? { password: editForm.password } : {}),
        phone: editForm.phone || null,
        ...(editForm.collegeId ? { collegeId: editForm.collegeId } : {}),
      });
      setEditing(null);
      setMsg("User updated");
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Update failed");
    }
  }

  async function onDelete(u: UserRow) {
    if (!confirm(`Delete ${u.fullName}? They will no longer be able to login.`)) return;
    setErr("");
    try {
      await api.delete(`/users/${u.id}`);
      setMsg("User deleted");
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setErr(ax.response?.data?.message || "Delete failed");
    }
  }

  function collegeName(u: UserRow) {
    return u.internProfile?.college?.name || u.collegeProfile?.college?.name || "—";
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={isAdmin ? "Manage admins, HR, trainers, interns & colleges" : "Create & manage trainer, intern, college (and HR) accounts"}
      />

      <form onSubmit={onCreate} className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <input className="rounded-lg border px-3 py-2.5 text-sm" placeholder="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className="rounded-lg border px-3 py-2.5 text-sm" placeholder="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="rounded-lg border px-3 py-2.5 text-sm" placeholder="Password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="rounded-lg border px-3 py-2.5 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {roleOptions()}
        </select>
        <input className="rounded-lg border px-3 py-2.5 text-sm" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        {(form.role === "INTERN" || form.role === "COLLEGE") && (
          <select className="rounded-lg border px-3 py-2.5 text-sm" required value={form.collegeId} onChange={(e) => setForm({ ...form, collegeId: e.target.value })}>
            <option value="">Select college</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white sm:col-span-2 lg:col-span-3">
          Create user
        </button>
      </form>

      {msg && <p className="mb-3 text-sm text-green-700">{msg}</p>}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {users.map((u) => (
          <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{u.fullName}</p>
                <p className="text-xs text-slate-500 break-all">{u.email}</p>
                <p className="mt-1 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">{u.role}</span>
                  <span className="ml-2 text-slate-500">{collegeName(u)}</span>
                </p>
              </div>
              <div className="flex gap-1">
                {canEdit(u) && (
                  <button type="button" onClick={() => openEdit(u)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {canDelete(u) && (
                  <button type="button" onClick={() => void onDelete(u)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">College</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">{collegeName(u)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {canEdit(u) && (
                      <button type="button" onClick={() => openEdit(u)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                        Edit
                      </button>
                    )}
                    {canDelete(u) && (
                      <button type="button" onClick={() => void onDelete(u)} className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <form onSubmit={onSaveEdit} className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit {editing.role}</h2>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <input className="w-full rounded-lg border px-3 py-2.5 text-sm" required value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} placeholder="Full name" />
              <input className="w-full rounded-lg border px-3 py-2.5 text-sm" type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" />
              <input className="w-full rounded-lg border px-3 py-2.5 text-sm" type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="New password (optional)" />
              <input className="w-full rounded-lg border px-3 py-2.5 text-sm" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone" />
              {(editing.role === "INTERN" || editing.role === "COLLEGE") && (
                <select className="w-full rounded-lg border px-3 py-2.5 text-sm" value={editForm.collegeId} onChange={(e) => setEditForm({ ...editForm, collegeId: e.target.value })}>
                  <option value="">Select college</option>
                  {colleges.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <button type="submit" className="mt-4 w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white">
              Save changes
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
