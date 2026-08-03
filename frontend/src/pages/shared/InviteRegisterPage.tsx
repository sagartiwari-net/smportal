import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { ROLE_HOME } from "../../lib/roles";

type DraftRow = {
  key: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  password: string;
};

type InviteInfo = {
  id: string;
  status?: string;
  college: { name: string };
  group: { name: string };
  remaining: number | null;
  usedCount: number;
  maxRegistrations: number | null;
  batchLimit?: number | null;
  oneTime?: boolean;
  expiresAt: string;
  pendingCount: number;
  canSubmit: boolean;
  blockReason: string | null;
  note?: string | null;
};

const emptyRow = (): DraftRow => ({
  key: crypto.randomUUID(),
  fullName: "",
  email: "",
  phone: "",
  address: "",
  password: "",
});

const inputCls =
  "w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-green-500";

export function InviteRegisterPage() {
  const { token = "" } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([emptyRow()]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const loadInvite = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/registration/invite/${token}`);
      setInvite(data.invite);
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setError(m || "Invalid or expired invite.");
      setInvite(null);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
      return;
    }
    if (user.role !== "COLLEGE" && user.role !== "ADMIN" && user.role !== "HR") {
      navigate(ROLE_HOME[user.role], { replace: true });
      return;
    }
    void loadInvite();
  }, [authLoading, user, token, navigate, loadInvite]);

  function updateDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeDraft(key: string) {
    setDrafts((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
  }

  async function onExcel(file: File | null) {
    if (!file || !token) return;
    setBusy(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      const fileBase64 = btoa(binary);
      const { data } = await api.post(`/registration/invite/${token}/parse-excel`, { fileBase64 });
      if (data.errors?.length) {
        setError(`Excel issues: ${data.errors.map((e: { row: number; message: string }) => `row ${e.row}`).join(", ")}`);
      }
      const rows: DraftRow[] = (data.rows || []).map(
        (r: { fullName: string; email: string; phone: string; address: string; password: string }) => ({
          key: crypto.randomUUID(),
          ...r,
        }),
      );
      if (rows.length) {
        setDrafts((prev) => {
          const onlyBlank =
            prev.length === 1 &&
            !prev[0].fullName &&
            !prev[0].email &&
            !prev[0].phone &&
            !prev[0].address &&
            !prev[0].password;
          return onlyBlank ? rows : [...prev, ...rows];
        });
        setSuccess(`Loaded ${rows.length} row(s) into draft — review before submit.`);
      }
    } catch {
      setError("Could not parse Excel file.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const res = await api.get("/registration/template.xlsx", { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "intern-registration-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function goConfirm(e: FormEvent) {
    e.preventDefault();
    setError("");
    for (const r of drafts) {
      if (!r.fullName.trim() || !r.email.trim() || !r.phone.trim() || !r.address.trim() || !r.password.trim()) {
        setError("Fill all fields for every intern (name, email, phone, address, password).");
        return;
      }
      if (r.password.length < 6) {
        setError(`Password too short for ${r.fullName || r.email}`);
        return;
      }
    }
    setConfirming(true);
  }

  async function submitFinal() {
    if (!token || !invite?.canSubmit) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(`/registration/invite/${token}/submit`, {
        interns: drafts.map(({ fullName, email, phone, address, password }) => ({
          fullName,
          email,
          phone,
          address,
          password,
        })),
      });
      setSuccess(data.message || `Submitted ${data.submitted} intern(s) for approval.`);
      setDrafts([emptyRow()]);
      setConfirming(false);
      await loadInvite();
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setError(m || "Submit failed.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return <p className="p-6 text-sm text-slate-500">Loading invite…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageHeader title="College intern registration" subtitle="Fill details → review → submit for Admin/HR approval" />
        {user && (
          <Link to={ROLE_HOME[user.role]} className="text-sm text-green-700 hover:underline">
            ← Back to dashboard
          </Link>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {success && <p className="mb-3 text-sm text-green-700">{success}</p>}

      {invite && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2.5 text-sm ${
            invite.canSubmit
              ? "border-teal-200 bg-teal-50 text-teal-900"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <p>
            <strong>{invite.college.name}</strong> · Group on approve: <strong>{invite.group.name}</strong>
            <span className="opacity-90">
              {" "}
              · One-time link
              {invite.maxRegistrations != null
                ? ` · max ${invite.maxRegistrations} in this submission`
                : " · unlimited batch size"}
              · Exp {String(invite.expiresAt).slice(0, 10)}
              {invite.status ? ` · ${invite.status}` : ""}
            </span>
          </p>
          <p className="mt-1 text-xs opacity-80">
            Submit once only. After submit the link cannot be reused — Admin/HR must create a new link for
            another batch.
          </p>
          {invite.blockReason && <p className="mt-1 text-xs font-medium text-amber-800">{invite.blockReason}</p>}
        </div>
      )}

      {!invite && !error && <p className="text-sm text-slate-500">Invite not available.</p>}

      {invite && !invite.canSubmit && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          <p className="font-medium text-slate-800">Registration closed for this link</p>
          <p className="mt-1">
            Each invite link works only once. After you submit (or if the link expired/revoked), Admin/HR must generate a
            new link for another batch.
          </p>
          {user && (
            <Link to={ROLE_HOME[user.role]} className="mt-3 inline-block text-sm text-green-700 hover:underline">
              ← Back to dashboard
            </Link>
          )}
        </div>
      )}

      {invite && invite.canSubmit && !confirming && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void downloadTemplate()} className="rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              Download Excel template
            </button>
            <label className="cursor-pointer rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              Upload Excel (draft)
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => void onExcel(e.target.files?.[0] || null)}
              />
            </label>
            <span className="text-xs text-slate-500">{drafts.length} row(s) in draft</span>
          </div>

          <form onSubmit={goConfirm} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-2 py-2">#</th>
                    <th className="min-w-[140px] px-2 py-2">Name</th>
                    <th className="min-w-[180px] px-2 py-2">Email</th>
                    <th className="min-w-[110px] px-2 py-2">Mobile</th>
                    <th className="min-w-[110px] px-2 py-2">Password</th>
                    <th className="min-w-[180px] px-2 py-2">Address</th>
                    <th className="w-16 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((row, idx) => (
                    <tr key={row.key} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="px-2 py-1.5 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-1 py-1">
                        <input required placeholder="Full name" className={inputCls} value={row.fullName} onChange={(e) => updateDraft(row.key, { fullName: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input required type="email" placeholder="email@college.edu" className={inputCls} value={row.email} onChange={(e) => updateDraft(row.key, { email: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input required placeholder="Mobile" className={inputCls} value={row.phone} onChange={(e) => updateDraft(row.key, { phone: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input required placeholder="Password" className={inputCls} value={row.password} onChange={(e) => updateDraft(row.key, { password: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input required placeholder="Address" className={inputCls} value={row.address} onChange={(e) => updateDraft(row.key, { address: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" onClick={() => removeDraft(row.key)} className="text-xs text-rose-600 hover:underline" title="Remove row">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 border-t bg-slate-50 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setDrafts((d) => [...d, emptyRow()])}
                className="rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                + Add more
              </button>
              <button
                type="submit"
                disabled={!invite.canSubmit || busy}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                Review & confirm
              </button>
            </div>
          </form>
        </div>
      )}

      {invite && invite.canSubmit && confirming && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Confirm before submit ({drafts.length} interns)</h3>
          <p className="text-xs text-slate-500">Edit or remove if needed, then submit for Admin/HR approval.</p>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Phone</th>
                  <th className="px-2 py-2">Address</th>
                  <th className="px-2 py-2">Password</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((r, i) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    {editingKey === r.key ? (
                      <>
                        <td className="px-1 py-1"><input className={inputCls} value={r.fullName} onChange={(e) => updateDraft(r.key, { fullName: e.target.value })} /></td>
                        <td className="px-1 py-1"><input className={inputCls} value={r.email} onChange={(e) => updateDraft(r.key, { email: e.target.value })} /></td>
                        <td className="px-1 py-1"><input className={inputCls} value={r.phone} onChange={(e) => updateDraft(r.key, { phone: e.target.value })} /></td>
                        <td className="px-1 py-1"><input className={inputCls} value={r.address} onChange={(e) => updateDraft(r.key, { address: e.target.value })} /></td>
                        <td className="px-1 py-1"><input className={inputCls} value={r.password} onChange={(e) => updateDraft(r.key, { password: e.target.value })} /></td>
                        <td className="px-2 py-1.5">
                          <button type="button" className="text-xs text-green-700 underline" onClick={() => setEditingKey(null)}>
                            Done
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 font-medium">{r.fullName}</td>
                        <td className="px-2 py-1.5">{r.email}</td>
                        <td className="px-2 py-1.5">{r.phone}</td>
                        <td className="px-2 py-1.5">{r.address}</td>
                        <td className="px-2 py-1.5">••••••</td>
                        <td className="space-x-2 px-2 py-1.5">
                          <button type="button" className="text-xs text-green-700 underline" onClick={() => setEditingKey(r.key)}>
                            Edit
                          </button>
                          <button type="button" className="text-xs text-rose-600 underline" onClick={() => removeDraft(r.key)}>
                            Del
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border px-3 py-1.5 text-sm">
              Back to form
            </button>
            <button
              type="button"
              disabled={!invite.canSubmit || busy || drafts.length === 0}
              onClick={() => void submitFinal()}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Submitting…" : `Submit ${drafts.length} for approval`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
