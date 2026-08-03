import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

type Profile = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  internProfile?: {
    phone?: string | null;
    address?: string | null;
    internshipStatus?: string;
    college?: { name: string } | null;
    memberships?: { group: { name: string; batchLabel?: string | null } }[];
  } | null;
  trainerProfile?: { phone?: string | null } | null;
  collegeProfile?: { phone?: string | null; college?: { name: string } | null } | null;
};

type InternRow = {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  address: string | null;
  internshipStatus: string;
  college: { id: string; name: string } | null;
  groups?: { id: string; name: string }[];
  locked: boolean;
};

type GroupNode = {
  id: string;
  name: string;
  batchLabel: string | null;
  activeCount: number;
  completedCount: number;
};

type CollegeNode = {
  id: string;
  name: string;
  activeCount: number;
  completedCount: number;
  ungroupedActive: number;
  ungroupedCompleted: number;
  groups: GroupNode[];
};

type TreeResponse = {
  mode: "college-group" | "group";
  totals: { active: number; completed: number };
  colleges?: CollegeNode[];
  groups?: GroupNode[];
  ungroupedActive?: number;
  ungroupedCompleted?: number;
};

type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500";

const PAGE_SIZE = 15;

function countForStatus(active: number, completed: number, status: "ACTIVE" | "COMPLETED") {
  return status === "COMPLETED" ? completed : active;
}

export function ProfilePage() {
  const { user } = useAuth();
  const [mainTab, setMainTab] = useState<"account" | "students">("account");
  const [statusTab, setStatusTab] = useState<"ACTIVE" | "COMPLETED">("ACTIVE");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [openCollege, setOpenCollege] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<string | null>(null); // groupId or `ungrouped:{collegeId}`
  const [interns, setInterns] = useState<InternRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [edit, setEdit] = useState<InternRow | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", address: "", note: "" });
  const [pw, setPw] = useState({ oldPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  const canEditStudents = user && ["ADMIN", "HR", "TRAINER", "COLLEGE"].includes(user.role);
  const reportBase =
    user?.role === "ADMIN"
      ? "/admin"
      : user?.role === "HR"
        ? "/hr"
        : user?.role === "TRAINER"
          ? "/trainer"
          : user?.role === "COLLEGE"
            ? "/college"
            : "";

  const load = useCallback(async () => {
    const { data } = await api.get("/profile/me");
    setProfile(data.profile);
  }, []);

  const loadTree = useCallback(async () => {
    if (!canEditStudents) return;
    const { data } = await api.get("/profile/student-tree");
    setTree(data);
  }, [canEditStudents]);

  useEffect(() => {
    void load().catch(() => setErr("Could not load profile"));
  }, [load]);

  useEffect(() => {
    if (mainTab === "students") void loadTree().catch(() => setErr("Could not load student tree"));
  }, [mainTab, loadTree]);

  useEffect(() => {
    setOpenBucket(null);
    setInterns([]);
    setPageMeta({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
  }, [statusTab]);

  const loadInternsPage = useCallback(
    async (opts: {
      groupId?: string | null;
      collegeId?: string | null;
      ungrouped?: boolean;
      page?: number;
      search?: string;
    }) => {
      if (!canEditStudents) return;
      setListLoading(true);
      setErr("");
      try {
        const { data } = await api.get("/profile/interns", {
          params: {
            status: statusTab,
            groupId: opts.groupId || undefined,
            collegeId: opts.collegeId || undefined,
            ungrouped: opts.ungrouped ? "1" : undefined,
            page: opts.page || 1,
            pageSize: PAGE_SIZE,
            q: opts.search || undefined,
          },
        });
        setInterns(data.interns || []);
        setPageMeta({
          total: data.total || 0,
          page: data.page || 1,
          pageSize: data.pageSize || PAGE_SIZE,
          totalPages: data.totalPages || 1,
        });
      } catch {
        setErr("Could not load students");
      } finally {
        setListLoading(false);
      }
    },
    [canEditStudents, statusTab],
  );

  async function openGroupBucket(key: string, params: {
    groupId?: string | null;
    collegeId?: string | null;
    ungrouped?: boolean;
  }) {
    setOpenBucket((prev) => (prev === key ? null : key));
    if (openBucket === key) {
      setInterns([]);
      return;
    }
    setAppliedQ("");
    setQ("");
    await loadInternsPage({ ...params, page: 1 });
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    if (pw.newPassword !== pw.confirm) {
      setErr("New password and confirm do not match");
      return;
    }
    setBusy(true);
    try {
      await api.patch("/profile/password", {
        oldPassword: pw.oldPassword,
        newPassword: pw.newPassword,
      });
      setMsg("Password updated successfully.");
      setPw({ oldPassword: "", newPassword: "", confirm: "" });
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Password change failed");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(row: InternRow) {
    if (row.locked) {
      setErr("Completed internship — only Admin/HR can change details.");
      return;
    }
    setEdit(row);
    setForm({
      fullName: row.fullName,
      email: row.email,
      phone: row.phone || "",
      address: row.address || "",
      note: "",
    });
    setMsg("");
    setErr("");
  }

  async function saveIntern(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const { data } = await api.patch(`/profile/interns/${edit.userId}`, {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone || null,
        address: form.address || null,
        note: form.note || null,
      });
      setMsg(
        data.mode === "request"
          ? "Change request sent — waiting for Admin/HR/Trainer approval."
          : "Student profile updated.",
      );
      setEdit(null);
      await loadTree();
      if (openBucket) {
        await loadInternsPage({
          page: pageMeta.page,
          search: appliedQ || undefined,
          ...parseBucketKey(openBucket),
        });
      }
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function parseBucketKey(key: string): {
    groupId?: string | null;
    collegeId?: string | null;
    ungrouped?: boolean;
  } {
    if (key.startsWith("ungrouped:")) {
      return { ungrouped: true, collegeId: key.slice("ungrouped:".length) };
    }
    if (key.startsWith("group:")) {
      const rest = key.slice("group:".length);
      const [groupId, collegeId] = rest.split("|");
      return { groupId, collegeId: collegeId || undefined };
    }
    return { groupId: key };
  }

  const phone =
    profile?.internProfile?.phone ||
    profile?.trainerProfile?.phone ||
    profile?.collegeProfile?.phone ||
    "—";

  function renderStudentTable() {
    return (
      <div className="border-t bg-white">
        <div className="flex flex-wrap gap-2 border-b bg-slate-50/80 p-3">
          <input
            placeholder="Search in this group…"
            className={`${inputCls} max-w-xs`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && openBucket) {
                setAppliedQ(q.trim());
                void loadInternsPage({
                  page: 1,
                  search: q.trim() || undefined,
                  ...parseBucketKey(openBucket),
                });
              }
            }}
          />
          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-2 text-sm"
            onClick={() => {
              if (!openBucket) return;
              setAppliedQ(q.trim());
              void loadInternsPage({
                page: 1,
                search: q.trim() || undefined,
                ...parseBucketKey(openBucket),
              });
            }}
          >
            Search
          </button>
          <span className="self-center text-xs text-slate-500">
            {listLoading ? "Loading…" : `${pageMeta.total} student(s)`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {interns.map((row) => (
                <tr key={row.userId} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium">{row.fullName}</td>
                  <td className="px-3 py-2 text-slate-600">{row.email}</td>
                  <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.internshipStatus}
                    {row.locked ? " · locked" : ""}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={row.locked && user?.role !== "ADMIN" && user?.role !== "HR"}
                      className="text-xs text-green-700 underline disabled:opacity-40"
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!listLoading && interns.length === 0 && (
            <p className="p-3 text-sm text-slate-500">No students in this list.</p>
          )}
        </div>

        {pageMeta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
            <button
              type="button"
              disabled={pageMeta.page <= 1 || listLoading}
              className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
              onClick={() => {
                if (!openBucket) return;
                void loadInternsPage({
                  page: pageMeta.page - 1,
                  search: appliedQ || undefined,
                  ...parseBucketKey(openBucket),
                });
              }}
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {pageMeta.page} / {pageMeta.totalPages}
            </span>
            <button
              type="button"
              disabled={pageMeta.page >= pageMeta.totalPages || listLoading}
              className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
              onClick={() => {
                if (!openBucket) return;
                void loadInternsPage({
                  page: pageMeta.page + 1,
                  search: appliedQ || undefined,
                  ...parseBucketKey(openBucket),
                });
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderGroupRow(
    g: GroupNode,
    collegeId?: string,
  ) {
    const n = countForStatus(g.activeCount, g.completedCount, statusTab);
    if (n === 0) return null;
    const key = collegeId ? `group:${g.id}|${collegeId}` : `group:${g.id}`;
    const open = openBucket === key;
    return (
      <div key={g.id} className="overflow-hidden rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() =>
            void openGroupBucket(key, {
              groupId: g.id,
              collegeId: collegeId === "__none__" ? "__none__" : collegeId,
            })
          }
          className="flex w-full items-center justify-between gap-2 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50"
        >
          <span>
            <span className="text-slate-400">{open ? "▾" : "▸"}</span>{" "}
            <span className="font-medium text-slate-800">{g.name}</span>
            {g.batchLabel ? <span className="text-xs text-slate-400"> · {g.batchLabel}</span> : null}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{n}</span>
        </button>
        {open && renderStudentTable()}
      </div>
    );
  }

  function renderUngrouped(collegeId: string, active: number, completed: number) {
    const n = countForStatus(active, completed, statusTab);
    if (n === 0) return null;
    const key = `ungrouped:${collegeId}`;
    const open = openBucket === key;
    return (
      <div className="overflow-hidden rounded-lg border border-dashed border-slate-300">
        <button
          type="button"
          onClick={() =>
            void openGroupBucket(key, {
              ungrouped: true,
              collegeId: collegeId === "__all__" ? undefined : collegeId,
            })
          }
          className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 text-left text-sm hover:bg-slate-100"
        >
          <span>
            <span className="text-slate-400">{open ? "▾" : "▸"}</span>{" "}
            <span className="font-medium text-slate-700">No group assigned</span>
          </span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">{n}</span>
        </button>
        {open && renderStudentTable()}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Profile" subtitle="Account details · password · student profiles (scoped)" />

      {canEditStudents && (
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {(
            [
              ["account", "My account"],
              ["students", "Student profiles"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMainTab(id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                mainTab === id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
              {id === "students" && tree
                ? ` (${statusTab === "ACTIVE" ? tree.totals.active : tree.totals.completed})`
                : ""}
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}

      {mainTab === "account" && (
        <div className="space-y-6">
          {profile && (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800">My details</h3>
              <p className="mt-1 text-xs text-slate-500">
                Profile fields cannot be edited by you. Ask Admin/HR
                {user?.role === "INTERN" ? "/Trainer/College" : ""} if something needs correction.
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Full name</dt>
                  <dd className="font-medium">{profile.fullName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Email</dt>
                  <dd className="font-medium">{profile.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Role</dt>
                  <dd className="font-medium">{profile.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Phone</dt>
                  <dd className="font-medium">{phone}</dd>
                </div>
                {profile.internProfile && (
                  <>
                    <div>
                      <dt className="text-xs text-slate-500">Address</dt>
                      <dd className="font-medium">{profile.internProfile.address || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">College</dt>
                      <dd className="font-medium">{profile.internProfile.college?.name || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Internship</dt>
                      <dd className="font-medium">{profile.internProfile.internshipStatus || "ACTIVE"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Groups</dt>
                      <dd className="font-medium">
                        {profile.internProfile.memberships?.map((m) => m.group.name).join(", ") || "—"}
                      </dd>
                    </div>
                  </>
                )}
                {profile.collegeProfile?.college && (
                  <div>
                    <dt className="text-xs text-slate-500">College</dt>
                    <dd className="font-medium">{profile.collegeProfile.college.name}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          <form onSubmit={changePassword} className="max-w-md space-y-3 rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Change password</h3>
            <input
              required
              type="password"
              placeholder="Current password"
              className={inputCls}
              value={pw.oldPassword}
              onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })}
            />
            <input
              required
              type="password"
              minLength={6}
              placeholder="New password (min 6)"
              className={inputCls}
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            />
            <input
              required
              type="password"
              minLength={6}
              placeholder="Confirm new password"
              className={inputCls}
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              Update password
            </button>
          </form>
        </div>
      )}

      {mainTab === "students" && canEditStudents && (
        <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Student profiles</h3>
              <p className="text-xs text-slate-500">
                {user?.role === "ADMIN" || user?.role === "HR"
                  ? "College → group → students. Open a group to load a page of students."
                  : "Group → students. Open a group to load a page (not the full list)."}
                {user?.role === "COLLEGE" ? " Edits need approval." : ""}
              </p>
            </div>
            {reportBase && (
              <Link to={`${reportBase}/profile-changes`} className="text-sm text-green-700 underline">
                Change requests / report →
              </Link>
            )}
          </div>

          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(
              [
                ["ACTIVE", `Active (${tree?.totals.active ?? 0})`],
                ["COMPLETED", `Completed (${tree?.totals.completed ?? 0})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusTab(id)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                  statusTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!tree && <p className="text-sm text-slate-500">Loading structure…</p>}

          {tree?.mode === "college-group" && (
            <div className="space-y-2">
              {(tree.colleges || [])
                .filter((c) => countForStatus(c.activeCount, c.completedCount, statusTab) > 0)
                .map((college) => {
                  const open = openCollege === college.id;
                  const total = countForStatus(college.activeCount, college.completedCount, statusTab);
                  return (
                    <div key={college.id} className="overflow-hidden rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenCollege(open ? null : college.id);
                          setOpenBucket(null);
                          setInterns([]);
                        }}
                        className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100/80"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">
                            <span className="text-slate-400">{open ? "▾" : "▸"}</span> {college.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {college.groups.filter(
                              (g) => countForStatus(g.activeCount, g.completedCount, statusTab) > 0,
                            ).length}{" "}
                            group(s)
                          </p>
                        </div>
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          {total}
                        </span>
                      </button>
                      {open && (
                        <div className="space-y-2 border-t bg-white p-3">
                          {college.groups.map((g) => renderGroupRow(g, college.id))}
                          {renderUngrouped(
                            college.id,
                            college.ungroupedActive,
                            college.ungroupedCompleted,
                          )}
                          {college.groups.every(
                            (g) => countForStatus(g.activeCount, g.completedCount, statusTab) === 0,
                          ) &&
                            countForStatus(college.ungroupedActive, college.ungroupedCompleted, statusTab) ===
                              0 && (
                              <p className="text-sm text-slate-500">No groups for this filter.</p>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              {(tree.colleges || []).every(
                (c) => countForStatus(c.activeCount, c.completedCount, statusTab) === 0,
              ) && <p className="text-sm text-slate-500">No students for this status.</p>}
            </div>
          )}

          {tree?.mode === "group" && (
            <div className="space-y-2">
              {(tree.groups || []).map((g) => renderGroupRow(g))}
              {renderUngrouped(
                "__all__",
                tree.ungroupedActive || 0,
                tree.ungroupedCompleted || 0,
              )}
              {(tree.groups || []).every(
                (g) => countForStatus(g.activeCount, g.completedCount, statusTab) === 0,
              ) &&
                countForStatus(tree.ungroupedActive || 0, tree.ungroupedCompleted || 0, statusTab) === 0 && (
                  <p className="text-sm text-slate-500">No students for this status.</p>
                )}
            </div>
          )}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={saveIntern}
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-lg"
          >
            <h3 className="text-sm font-semibold">
              Edit student {user?.role === "COLLEGE" ? "(needs approval)" : ""}
            </h3>
            <input
              required
              className={inputCls}
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Full name"
            />
            <input
              required
              type="email"
              className={inputCls}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
            />
            <input
              className={inputCls}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Phone"
            />
            <textarea
              className={inputCls}
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Address"
            />
            {user?.role === "COLLEGE" && (
              <input
                className={inputCls}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Reason for change (optional)"
              />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {user?.role === "COLLEGE" ? "Submit for approval" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
