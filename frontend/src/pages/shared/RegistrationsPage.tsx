import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { PageHeader } from "../../components/ui/PageHeader";
import { ConfirmModal } from "../../components/ui/ConfirmModal";

type College = { id: string; name: string };
type Group = { id: string; name: string };
type CollegeUser = { id: string; fullName: string; email: string; collegeProfile?: { collegeId: string } | null };

type Invite = {
  id: string;
  status: string;
  maxRegistrations: number | null;
  usedCount: number;
  expiresAt: string;
  note?: string | null;
  pendingCount: number;
  college: { id: string; name: string };
  group: { id: string; name: string };
  boundUser?: { id: string; fullName: string; email: string } | null;
  createdBy: { fullName: string; role: string };
};

type PendingIntern = {
  id: string;
  phone?: string | null;
  address?: string | null;
  expiresAt?: string | null;
  inviteId?: string | null;
  user: { fullName: string; email: string; createdAt: string };
  college?: { name: string } | null;
  invite?: {
    id?: string;
    usedCount?: number;
    group: { id: string; name: string };
    boundUser?: { fullName: string; email: string } | null;
  } | null;
  registeredBy?: { fullName: string; email: string } | null;
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500";

export function RegistrationsPage() {
  const [tab, setTab] = useState<"pending" | "invites" | "direct">("pending");
  const [pending, setPending] = useState<PendingIntern[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [collegeUsers, setCollegeUsers] = useState<CollegeUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openColleges, setOpenColleges] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [revokeInviteId, setRevokeInviteId] = useState<string | null>(null);

  const [inviteForm, setInviteForm] = useState({
    collegeId: "",
    boundUserId: "",
    maxMode: "10" as "5" | "10" | "custom" | "unlimited",
    maxCustom: "25",
    expiresInDays: "7",
    note: "",
    groupMode: "existing" as "existing" | "new",
    groupId: "",
    newGroupName: "",
    newGroupBatch: "",
    trainerId: "",
  });

  const [hireForm, setHireForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    address: "",
    password: "password123",
    groupMode: "existing" as "existing" | "new",
    groupId: "",
    newGroupName: "",
    hireNote: "",
  });

  const trainers = useMemo(
    () => collegeUsers.filter(() => false),
    [collegeUsers],
  );

  const [trainerUsers, setTrainerUsers] = useState<{ id: string; fullName: string; email: string }[]>([]);

  async function load() {
    setErr("");
    try {
      const [p, inv, c, g, u] = await Promise.all([
        api.get("/registration/pending"),
        api.get("/registration/invites"),
        api.get("/colleges"),
        api.get("/groups"),
        api.get("/users"),
      ]);
      setPending(p.data.interns || []);
      const names = [...new Set((p.data.interns || []).map((i: PendingIntern) => i.college?.name || "No college"))];
      setOpenColleges(new Set(names.slice(0, 1)));
      setInvites(inv.data.invites || []);
      setColleges(c.data.colleges || []);
      setGroups((g.data.groups || []).map((x: Group) => ({ id: x.id, name: x.name })));
      const users = u.data.users || [];
      setCollegeUsers(users.filter((x: CollegeUser & { role?: string }) => x.role === "COLLEGE"));
      setTrainerUsers(
        users
          .filter((x: { role?: string }) => x.role === "TRAINER")
          .map((x: { id: string; fullName: string; email: string }) => ({
            id: x.id,
            fullName: x.fullName,
            email: x.email,
          })),
      );
      if (!inviteForm.collegeId && c.data.colleges?.[0]) {
        setInviteForm((f) => ({ ...f, collegeId: c.data.colleges[0].id }));
      }
      if (!inviteForm.groupId && g.data.groups?.[0]) {
        setInviteForm((f) => ({ ...f, groupId: g.data.groups[0].id }));
      }
      if (!hireForm.groupId && g.data.groups?.[0]) {
        setHireForm((f) => ({ ...f, groupId: g.data.groups[0].id }));
      }
    } catch {
      setErr("Could not load registrations.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collegeTeachers = collegeUsers.filter(
    (u) => !inviteForm.collegeId || u.collegeProfile?.collegeId === inviteForm.collegeId,
  );

  const pendingByCollege = useMemo(() => {
    const map = new Map<string, { key: string; name: string; interns: PendingIntern[] }>();
    for (const p of pending) {
      const name = p.college?.name || "No college";
      const key = name;
      if (!map.has(key)) map.set(key, { key, name, interns: [] });
      map.get(key)!.interns.push(p);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pending]);

  function toggleCollege(key: string) {
    setOpenColleges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCollegeSelect(interns: PendingIntern[]) {
    const ids = interns.map((i) => i.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map((p) => p.id)));
  }

  async function approveSelected() {
    if (!selected.size) return;
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const { data } = await api.post("/registration/approve", { internIds: [...selected] });
      setMsg(`Approved ${data.approved} intern(s). They are now in their invite group.`);
      setSelected(new Set());
      await load();
    } catch {
      setErr("Approve failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectSelected() {
    if (!selected.size) return;
    setConfirmReject(true);
  }

  async function doReject() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const { data } = await api.post("/registration/reject", { internIds: [...selected] });
      const remaining = data.remainingPendingByInvite
        ? Object.values(data.remainingPendingByInvite as Record<string, number>).reduce(
            (a: number, b) => a + Number(b),
            0,
          )
        : null;
      setMsg(
        `Rejected/deleted ${data.rejected} intern(s).` +
          (remaining != null
            ? ` ${remaining} from the same invite batch still pending (link stays used — generate a new link for another batch).`
            : " Invite link stays used; generate a new link for another batch."),
      );
      setSelected(new Set());
      setConfirmReject(false);
      await load();
    } catch {
      setErr("Reject failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setErr("");
    setCreatedLink("");
    try {
      let maxRegistrations: number | null = null;
      if (inviteForm.maxMode === "5") maxRegistrations = 5;
      else if (inviteForm.maxMode === "10") maxRegistrations = 10;
      else if (inviteForm.maxMode === "custom") maxRegistrations = Number(inviteForm.maxCustom) || 25;
      else maxRegistrations = null;

      const body: Record<string, unknown> = {
        collegeId: inviteForm.collegeId,
        boundUserId: inviteForm.boundUserId || null,
        maxRegistrations,
        expiresInDays: Number(inviteForm.expiresInDays) || 7,
        note: inviteForm.note || null,
      };
      if (inviteForm.groupMode === "existing") {
        body.groupId = inviteForm.groupId;
      } else {
        body.newGroup = {
          name: inviteForm.newGroupName,
          batchLabel: inviteForm.newGroupBatch || undefined,
          trainerId: inviteForm.trainerId || null,
        };
      }

      const { data } = await api.post("/registration/invites", body);
      setCreatedLink(data.link);
      setMsg("Invite created — copy the link and share with the college teacher.");
      await load();
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Could not create invite.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    setRevokeInviteId(id);
  }

  async function doRevoke() {
    if (!revokeInviteId) return;
    setBusy(true);
    setErr("");
    try {
      await api.post(`/registration/invites/${revokeInviteId}/revoke`);
      setRevokeInviteId(null);
      setMsg("Invite link revoked.");
      await load();
    } catch {
      setErr("Could not revoke invite.");
    } finally {
      setBusy(false);
    }
  }

  async function directHire(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const body: Record<string, unknown> = {
        fullName: hireForm.fullName,
        email: hireForm.email,
        phone: hireForm.phone || null,
        address: hireForm.address || null,
        password: hireForm.password,
        hireNote: hireForm.hireNote || "Direct company hire",
      };
      if (hireForm.groupMode === "existing") body.groupId = hireForm.groupId;
      else body.newGroup = { name: hireForm.newGroupName };

      await api.post("/registration/direct-hire", body);
      setMsg("Direct hire intern created and added to group (active immediately).");
      setHireForm((f) => ({
        ...f,
        fullName: "",
        email: "",
        phone: "",
        address: "",
      }));
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Direct hire failed.");
    } finally {
      setBusy(false);
    }
  }

  void trainers;

  return (
    <div>
      <ConfirmModal
        open={confirmReject}
        title="Reject pending accounts?"
        message={
          <>
            This will permanently delete <strong>{selected.size}</strong> pending account
            {selected.size === 1 ? "" : "s"}. Partial reject is OK — other pending students from the
            same invite stay in the queue. The invite link stays <strong>USED</strong> (one-time);
            ask Admin/HR for a new link if the college needs to submit again.
          </>
        }
        confirmLabel="Reject & delete"
        cancelLabel="Keep them"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmReject(false)}
        onConfirm={() => void doReject()}
      />
      <ConfirmModal
        open={!!revokeInviteId}
        title="Revoke invite link?"
        message="Teachers will no longer be able to use this link to register interns. Existing pending submissions are not deleted."
        confirmLabel="Revoke link"
        cancelLabel="Cancel"
        tone="danger"
        busy={busy}
        onCancel={() => setRevokeInviteId(null)}
        onConfirm={() => void doRevoke()}
      />

      <PageHeader
        title="Intern registrations"
        subtitle="Invite links for colleges · approve pending · direct company hires"
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {(
          [
            ["pending", "Pending approval"],
            ["invites", "Invite links"],
            ["direct", "Direct hire"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              tab === id ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
            {id === "pending" && pending.length > 0 ? ` (${pending.length})` : ""}
          </button>
        ))}
      </div>

      {msg && <p className="mb-3 text-sm text-green-700">{msg}</p>}
      {err && <p className="mb-3 text-sm text-rose-600">{err}</p>}

      {tab === "pending" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selected.size || busy}
              onClick={approveSelected}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve selected ({selected.size})
            </button>
            <button
              type="button"
              disabled={!selected.size || busy}
              onClick={rejectSelected}
              className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Reject / delete selected
            </button>
            <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm">
              Refresh
            </button>
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              {pending.length > 0 && selected.size === pending.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            College-wise groups — open a college to see its pending interns. You can approve or reject
            part of a batch; rejected rows are deleted, remaining stay pending. Invite links are one-time
            (USED after submit). Auto-delete after 7 days if not approved.
          </p>

          {pendingByCollege.length === 0 && (
            <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No pending registrations.</p>
          )}

          <div className="space-y-2">
            {pendingByCollege.map((group) => {
              const open = openColleges.has(group.key);
              const ids = group.interns.map((i) => i.id);
              const selectedInGroup = ids.filter((id) => selected.has(id)).length;
              const allInGroup = selectedInGroup === ids.length && ids.length > 0;
              return (
                <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleCollege(group.key)}
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100/80"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-slate-400">{open ? "▾" : "▸"}</span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{group.name}</p>
                        <p className="text-xs text-slate-500">
                          {group.interns.length} pending
                          {selectedInGroup > 0 ? ` · ${selectedInGroup} selected` : ""}
                        </p>
                      </div>
                    </div>
                    <span
                      role="presentation"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollegeSelect(group.interns);
                      }}
                      className="shrink-0 rounded-lg border bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-green-50"
                    >
                      {allInGroup ? "Unselect college" : "Select college"}
                    </span>
                  </button>

                  {open && (
                    <div className="overflow-x-auto border-t">
                      <table className="min-w-full text-left text-sm">
                        <thead className="border-b bg-white text-xs text-slate-500">
                          <tr>
                            <th className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={allInGroup}
                                onChange={() => toggleCollegeSelect(group.interns)}
                              />
                            </th>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Batch / group</th>
                            <th className="px-3 py-2">Phone</th>
                            <th className="px-3 py-2">Submitted by</th>
                            <th className="px-3 py-2">Expires</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.interns.map((p) => {
                            const batchPending = group.interns.filter(
                              (x) => (x.inviteId || x.invite?.id) === (p.inviteId || p.invite?.id),
                            ).length;
                            return (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50/80">
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium">{p.user.fullName}</div>
                                <div className="text-xs text-slate-400">{p.user.email}</div>
                                {p.address && <div className="text-xs text-slate-500">{p.address}</div>}
                              </td>
                              <td className="px-3 py-2">
                                <div>{p.invite?.group.name || "—"}</div>
                                {p.inviteId || p.invite?.id ? (
                                  <div className="text-xs text-slate-400">
                                    Batch pending: {batchPending}
                                    {p.invite?.usedCount != null ? ` · submitted ${p.invite.usedCount}` : ""}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">{p.phone || "—"}</td>
                              <td className="px-3 py-2 text-xs">
                                {p.registeredBy?.fullName || "—"}
                                <div className="text-slate-400">{p.registeredBy?.email}</div>
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {p.expiresAt ? String(p.expiresAt).slice(0, 10) : "—"}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "invites" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={createInvite} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Generate invite link</h3>
            <label className="block text-xs font-medium text-slate-600">
              College
              <select
                required
                className={`${inputCls} mt-1`}
                value={inviteForm.collegeId}
                onChange={(e) => setInviteForm({ ...inviteForm, collegeId: e.target.value, boundUserId: "" })}
              >
                {colleges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Bind to college teacher (optional)
              <select
                className={`${inputCls} mt-1`}
                value={inviteForm.boundUserId}
                onChange={(e) => setInviteForm({ ...inviteForm, boundUserId: e.target.value })}
              >
                <option value="">Any teacher of this college</option>
                {collegeTeachers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Max students in one submission
              <select
                className={`${inputCls} mt-1`}
                value={inviteForm.maxMode}
                onChange={(e) =>
                  setInviteForm({ ...inviteForm, maxMode: e.target.value as typeof inviteForm.maxMode })
                }
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="custom">Custom</option>
                <option value="unlimited">Unlimited (∞ in one submit)</option>
              </select>
              <span className="mt-1 block font-normal text-slate-400">
                Link is always one-time: teacher submits once, then the link becomes USED. This number only
                caps how many interns they may include in that single batch.
              </span>
            </label>
            {inviteForm.maxMode === "custom" && (
              <label className="block text-xs font-medium text-slate-600">
                Custom max
                <input
                  type="number"
                  min={1}
                  className={`${inputCls} mt-1`}
                  value={inviteForm.maxCustom}
                  onChange={(e) => setInviteForm({ ...inviteForm, maxCustom: e.target.value })}
                />
              </label>
            )}
            <label className="block text-xs font-medium text-slate-600">
              Link expires in (days)
              <input
                type="number"
                min={1}
                max={30}
                className={`${inputCls} mt-1`}
                value={inviteForm.expiresInDays}
                onChange={(e) => setInviteForm({ ...inviteForm, expiresInDays: e.target.value })}
              />
            </label>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">Target group (auto-assign on approve)</p>
              <div className="mb-2 flex gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={inviteForm.groupMode === "existing"}
                    onChange={() => setInviteForm({ ...inviteForm, groupMode: "existing" })}
                  />
                  Existing
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={inviteForm.groupMode === "new"}
                    onChange={() => setInviteForm({ ...inviteForm, groupMode: "new" })}
                  />
                  New group
                </label>
              </div>
              {inviteForm.groupMode === "existing" ? (
                <select
                  required
                  className={inputCls}
                  value={inviteForm.groupId}
                  onChange={(e) => setInviteForm({ ...inviteForm, groupId: e.target.value })}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <input
                    required
                    placeholder="New group name"
                    className={inputCls}
                    value={inviteForm.newGroupName}
                    onChange={(e) => setInviteForm({ ...inviteForm, newGroupName: e.target.value })}
                  />
                  <input
                    placeholder="Batch label (optional)"
                    className={inputCls}
                    value={inviteForm.newGroupBatch}
                    onChange={(e) => setInviteForm({ ...inviteForm, newGroupBatch: e.target.value })}
                  />
                  <select
                    className={inputCls}
                    value={inviteForm.trainerId}
                    onChange={(e) => setInviteForm({ ...inviteForm, trainerId: e.target.value })}
                  >
                    <option value="">Trainer (optional)</option>
                    {trainerUsers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <label className="block text-xs font-medium text-slate-600">
              Note (optional)
              <input
                className={`${inputCls} mt-1`}
                value={inviteForm.note}
                onChange={(e) => setInviteForm({ ...inviteForm, note: e.target.value })}
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Generate link"}
            </button>

            {createdLink && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
                <p className="font-medium text-teal-900">Share this link (shown once):</p>
                <p className="mt-1 break-all text-teal-800">{createdLink}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-teal-700 underline"
                  onClick={() => navigator.clipboard.writeText(createdLink)}
                >
                  Copy link
                </button>
              </div>
            )}
          </form>

          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold">Recent invites</div>
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="px-3 py-2">College</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2">Limit</th>
                  <th className="px-3 py-2">Pending</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{inv.college.name}</div>
                      <div className="text-xs text-slate-400">
                        {inv.boundUser ? inv.boundUser.fullName : "Any teacher"}
                      </div>
                    </td>
                    <td className="px-3 py-2">{inv.group.name}</td>
                    <td className="px-3 py-2">
                      Submitted {inv.usedCount}
                      <div className="text-xs text-slate-400">
                        Batch cap {inv.maxRegistrations ?? "∞"} · one-time
                      </div>
                    </td>
                    <td className="px-3 py-2">{inv.pendingCount}</td>
                    <td className="px-3 py-2 text-xs">{inv.status}</td>
                    <td className="px-3 py-2">
                      {inv.status === "ACTIVE" && (
                        <button type="button" className="text-xs text-rose-600 underline" onClick={() => void revokeInvite(inv.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invites.length === 0 && <p className="p-4 text-sm text-slate-500">No invites yet.</p>}
          </div>
        </div>
      )}

      {tab === "direct" && (
        <form onSubmit={directHire} className="max-w-xl space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Direct company hire (no college)</h3>
          <p className="text-xs text-slate-500">
            Creates an active intern immediately. College teachers will not see them — only Admin/HR/Trainer (via group).
          </p>
          <input required placeholder="Full name" className={inputCls} value={hireForm.fullName} onChange={(e) => setHireForm({ ...hireForm, fullName: e.target.value })} />
          <input required type="email" placeholder="Email" className={inputCls} value={hireForm.email} onChange={(e) => setHireForm({ ...hireForm, email: e.target.value })} />
          <input placeholder="Phone" className={inputCls} value={hireForm.phone} onChange={(e) => setHireForm({ ...hireForm, phone: e.target.value })} />
          <input placeholder="Address" className={inputCls} value={hireForm.address} onChange={(e) => setHireForm({ ...hireForm, address: e.target.value })} />
          <input required type="text" placeholder="Password" className={inputCls} value={hireForm.password} onChange={(e) => setHireForm({ ...hireForm, password: e.target.value })} />

          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="mb-2 flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={hireForm.groupMode === "existing"} onChange={() => setHireForm({ ...hireForm, groupMode: "existing" })} />
                Existing group
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={hireForm.groupMode === "new"} onChange={() => setHireForm({ ...hireForm, groupMode: "new" })} />
                New group
              </label>
            </div>
            {hireForm.groupMode === "existing" ? (
              <select required className={inputCls} value={hireForm.groupId} onChange={(e) => setHireForm({ ...hireForm, groupId: e.target.value })}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                placeholder="New group name"
                className={inputCls}
                value={hireForm.newGroupName}
                onChange={(e) => setHireForm({ ...hireForm, newGroupName: e.target.value })}
              />
            )}
          </div>

          <button type="submit" disabled={busy} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            Create intern
          </button>
        </form>
      )}
    </div>
  );
}
