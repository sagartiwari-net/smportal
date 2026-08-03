import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

type ChangeRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  proposedFullName?: string | null;
  proposedEmail?: string | null;
  proposedPhone?: string | null;
  proposedAddress?: string | null;
  previousFullName?: string | null;
  previousEmail?: string | null;
  previousPhone?: string | null;
  previousAddress?: string | null;
  note?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  targetUser: {
    id: string;
    fullName: string;
    email: string;
    internProfile?: {
      college?: { name: string } | null;
      internshipStatus?: string;
    } | null;
  };
  requestedBy: { fullName: string; email: string; role: string };
  reviewedBy?: { fullName: string; email: string; role: string } | null;
};

export function ProfileChangesPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const canReview = user && ["ADMIN", "HR", "TRAINER"].includes(user.role);

  const load = useCallback(async () => {
    const params = filter === "ALL" ? {} : { status: filter };
    const { data } = await api.get("/profile/change-requests", { params });
    setRequests(data.requests || []);
  }, [filter]);

  useEffect(() => {
    void load().catch(() => setErr("Could not load change requests"));
  }, [load]);

  async function approve(id: string) {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      await api.post(`/profile/change-requests/${id}/approve`);
      setMsg("Change approved and applied.");
      await load();
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      await api.post(`/profile/change-requests/${id}/reject`);
      setMsg("Change request rejected.");
      await load();
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === "object" && "response" in ex
          ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErr(m || "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  function diffLine(label: string, prev?: string | null, next?: string | null) {
    if ((prev || "") === (next || "")) return null;
    return (
      <div key={label} className="text-xs">
        <span className="font-medium text-slate-600">{label}:</span>{" "}
        <span className="text-rose-600 line-through">{prev || "—"}</span>
        {" → "}
        <span className="text-green-700">{next || "—"}</span>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Profile change report"
        subtitle={
          canReview
            ? "Who requested changes, what changed, and who approved"
            : "Your submitted change requests"
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border bg-white p-1">
        {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filter === f ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {msg && <p className="mb-3 text-sm text-green-700">{msg}</p>}
      {err && <p className="mb-3 text-sm text-rose-600">{err}</p>}

      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">
                  {r.targetUser.fullName}{" "}
                  <span className="text-xs font-normal text-slate-500">({r.targetUser.email})</span>
                </p>
                <p className="text-xs text-slate-500">
                  {r.targetUser.internProfile?.college?.name || "—"} ·{" "}
                  {r.targetUser.internProfile?.internshipStatus || "ACTIVE"}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "PENDING"
                    ? "bg-amber-100 text-amber-800"
                    : r.status === "APPROVED"
                      ? "bg-green-100 text-green-800"
                      : "bg-rose-100 text-rose-800"
                }`}
              >
                {r.status}
              </span>
            </div>

            <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">
              {diffLine("Name", r.previousFullName, r.proposedFullName)}
              {diffLine("Email", r.previousEmail, r.proposedEmail)}
              {diffLine("Phone", r.previousPhone, r.proposedPhone)}
              {diffLine("Address", r.previousAddress, r.proposedAddress)}
            </div>

            <div className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <p>
                Requested by: <strong>{r.requestedBy.fullName}</strong> ({r.requestedBy.role}) ·{" "}
                {String(r.createdAt).slice(0, 16).replace("T", " ")}
              </p>
              <p>
                Reviewed by:{" "}
                {r.reviewedBy ? (
                  <>
                    <strong>{r.reviewedBy.fullName}</strong> ({r.reviewedBy.role})
                    {r.reviewedAt ? ` · ${String(r.reviewedAt).slice(0, 16).replace("T", " ")}` : ""}
                  </>
                ) : (
                  "—"
                )}
              </p>
              {r.note && <p className="sm:col-span-2">Note: {r.note}</p>}
            </div>

            {canReview && r.status === "PENDING" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve(r.id)}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reject(r.id)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
        {requests.length === 0 && (
          <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No change requests.</p>
        )}
      </div>
    </div>
  );
}
