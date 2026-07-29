import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

export function CollegeDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ count: 0, avgScore: 0, avgAttendance: 0, avgTasks: 0 });
  useEffect(() => {
    api.get("/analytics/interns").then((r) => setSummary(r.data.summary)).catch(() => {});
  }, []);
  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName}`} subtitle="Your college students overview" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Students", summary.count],
          ["Avg score", `${summary.avgScore}%`],
          ["Avg attendance", `${summary.avgAttendance}%`],
          ["Avg tasks", `${summary.avgTasks}%`],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border bg-white p-4">
            <p className="text-xs uppercase text-slate-500">{l}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <Link className="mt-6 inline-block rounded-lg bg-green-600 px-4 py-2 text-sm text-white" to="/college/analytics">
        Open full analytics
      </Link>
    </div>
  );
}
