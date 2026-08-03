import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

type Batch = {
  inviteId: string;
  status: string;
  group: { id: string; name: string } | null;
  college: { name: string } | null;
  submittedAt: string;
  totalSubmitted: number;
  pendingCount: number;
  approvedCount: number;
  rejectedOrRemoved: number;
  interns: {
    id: string;
    fullName: string;
    email: string;
    approvalStatus: string;
    expiresAt?: string | null;
  }[];
};

export function CollegeDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ count: 0, avgScore: 0, avgAttendance: 0, avgTasks: 0 });
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    api.get("/analytics/interns").then((r) => setSummary(r.data.summary)).catch(() => {});
    api
      .get("/registration/my-submissions")
      .then((r) => setBatches(r.data.batches || []))
      .catch(() => {});
  }, []);

  const pendingTotal = batches.reduce((a, b) => a + b.pendingCount, 0);

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName}`} subtitle="Your college students overview" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Students", summary.count],
          ["Avg score", `${summary.avgScore}%`],
          ["Avg attendance", `${summary.avgAttendance}%`],
          ["Pending approvals", pendingTotal],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border bg-white p-4">
            <p className="text-xs uppercase text-slate-500">{l}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white" to="/college/analytics">
          Open full analytics
        </Link>
        <Link className="rounded-lg border px-4 py-2 text-sm" to="/college/profile">
          Profile & student edits
        </Link>
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-semibold text-slate-800">Your registration submissions</h3>
        <p className="mt-1 text-xs text-slate-500">
          Status of batches you submitted via invite links (pending / approved).
        </p>
        <div className="mt-3 space-y-2">
          {batches.map((b) => (
            <div key={b.inviteId} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{b.group?.name || "Group"}</p>
                  <p className="text-xs text-slate-500">
                    Submitted {String(b.submittedAt).slice(0, 10)} · Link {b.status} · Total submitted{" "}
                    {b.totalSubmitted}
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                    {b.pendingCount} pending
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">
                    {b.approvedCount} approved
                  </span>
                  {b.rejectedOrRemoved > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {b.rejectedOrRemoved} removed
                    </span>
                  )}
                </div>
              </div>
              {b.interns.length > 0 && (
                <ul className="mt-3 divide-y text-sm">
                  {b.interns.slice(0, 8).map((i) => (
                    <li key={i.id} className="flex justify-between py-1.5">
                      <span>
                        {i.fullName} <span className="text-xs text-slate-400">{i.email}</span>
                      </span>
                      <span className="text-xs font-medium text-slate-600">{i.approvalStatus}</span>
                    </li>
                  ))}
                  {b.interns.length > 8 && (
                    <li className="py-1 text-xs text-slate-400">+{b.interns.length - 8} more</li>
                  )}
                </ul>
              )}
            </div>
          ))}
          {batches.length === 0 && (
            <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">
              No invite submissions yet. Use an invite link from Admin/HR to register students.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
