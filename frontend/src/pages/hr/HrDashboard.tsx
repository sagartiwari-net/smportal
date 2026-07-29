import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

export function HrDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ count: 0, avgScore: 0, avgAttendance: 0, avgTasks: 0 });

  useEffect(() => {
    api.get("/analytics/interns").then((r) => setSummary(r.data.summary)).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName}`} subtitle="HR dashboard overview" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Interns", value: summary.count },
          { label: "Avg score", value: `${summary.avgScore}%` },
          { label: "Avg attendance", value: `${summary.avgAttendance}%` },
          { label: "Avg task completion", value: `${summary.avgTasks}%` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white" to="/hr/users">Manage users</Link>
        <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" to="/hr/groups">Groups</Link>
        <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" to="/hr/tasks">Tasks</Link>
        <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" to="/hr/analytics">Analytics</Link>
      </div>
    </div>
  );
}
