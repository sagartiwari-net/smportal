import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type Perf = {
  score: number;
  attendanceRate: number;
  taskCompletionRate: number;
  present: number;
  absent: number;
  leave: number;
  doneTasks: number;
  totalTasks: number;
  groupName: string | null;
};

export function InternDashboard() {
  const { user } = useAuth();
  const [records, setRecords] = useState<{ date: string; status: string }[]>([]);
  const [perf, setPerf] = useState<Perf | null>(null);

  useEffect(() => {
    api.get("/attendance").then((r) => setRecords(r.data.records.slice(0, 7))).catch(() => {});
    api.get("/analytics/me").then((r) => setPerf(r.data.performance)).catch(() => {});
  }, [user]);

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName}`} subtitle="Track attendance and project completion from here" />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-4">
          <p className="text-xs font-medium uppercase text-teal-700">Attendance %</p>
          <p className="mt-1 text-3xl font-bold text-teal-900">{perf ? `${perf.attendanceRate}%` : "—"}</p>
          {perf && (
            <p className="mt-1 text-xs text-slate-500">
              {perf.present} present · {perf.absent} absent
            </p>
          )}
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4">
          <p className="text-xs font-medium uppercase text-sky-700">Projects completed %</p>
          <p className="mt-1 text-3xl font-bold text-sky-900">{perf ? `${perf.taskCompletionRate}%` : "—"}</p>
          {perf && (
            <p className="mt-1 text-xs text-slate-500">
              {perf.doneTasks}/{perf.totalTasks} approved done
            </p>
          )}
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50/50 p-4">
          <p className="text-xs font-medium uppercase text-green-700">Overall score</p>
          <p className="mt-1 text-3xl font-bold text-green-900">{perf ? `${perf.score}%` : "—"}</p>
          <p className="mt-1 text-xs text-slate-500">{perf?.groupName || "No group yet"}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Quick links</h3>
          <p className="mt-1 text-sm text-slate-500">{user?.email}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/intern/performance" className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white">
              My Performance
            </Link>
            <Link to="/intern/tasks" className="rounded-lg border px-3 py-2 text-sm text-green-800">
              My Tasks
            </Link>
            <Link to="/intern/attendance" className="rounded-lg border px-3 py-2 text-sm text-green-800">
              My Attendance
            </Link>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Recent Attendance</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {records.map((r, i) => (
              <li key={i} className="flex justify-between border-b py-1">
                <span>{formatDate(r.date)}</span>
                <Badge status={r.status} />
              </li>
            ))}
            {records.length === 0 && <li className="text-slate-400">No attendance yet</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
