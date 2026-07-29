import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { api } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type Perf = {
  internId: string;
  fullName: string;
  email: string;
  college: string | null;
  groupName: string | null;
  score: number;
  attendanceRate: number;
  taskCompletionRate: number;
  present: number;
  absent: number;
  leave: number;
  totalTasks: number;
  doneTasks: number;
  submittedTasks: number;
  needsImprovement: number;
};

export function InternPerformancePage() {
  const [perf, setPerf] = useState<Perf | null>(null);
  const [recent, setRecent] = useState<{ date: string; status: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/analytics/me")
      .then((r) => {
        setPerf(r.data.performance);
        setRecent(r.data.recentAttendance || []);
      })
      .catch(() => setError("Could not load your performance."));
  }, []);

  const gaugeOption = useMemo<EChartsOption>(() => {
    if (!perf) return {};
    return {
      series: [
        {
          type: "gauge",
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max: 100,
          radius: "95%",
          center: ["50%", "55%"],
          axisLine: {
            lineStyle: {
              width: 16,
              color: [
                [0.4, "#e11d48"],
                [0.7, "#d97706"],
                [1, "#16a34a"],
              ],
            },
          },
          pointer: { width: 4, length: "55%" },
          axisLabel: { distance: 18, fontSize: 10 },
          detail: {
            formatter: "{value}%",
            fontSize: 20,
            fontWeight: 700,
            offsetCenter: [0, "70%"],
          },
          data: [{ value: perf.score, name: "My score" }],
          title: { offsetCenter: [0, "90%"], fontSize: 12, color: "#64748b" },
        },
      ],
    };
  }, [perf]);

  const dualBarOption = useMemo<EChartsOption>(() => {
    if (!perf) return {};
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 16, top: 24, bottom: 32 },
      xAxis: { type: "category", data: ["Attendance %", "Projects done %"] },
      yAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          type: "bar",
          data: [
            { value: perf.attendanceRate, itemStyle: { color: "#0d9488", borderRadius: [6, 6, 0, 0] } },
            { value: perf.taskCompletionRate, itemStyle: { color: "#0284c8", borderRadius: [6, 6, 0, 0] } },
          ],
          barWidth: 48,
          label: { show: true, position: "top", formatter: "{c}%" },
        },
      ],
    };
  }, [perf]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!perf) return <p className="text-sm text-slate-500">Loading your performance…</p>;

  return (
    <div>
      <PageHeader
        title="My Performance"
        subtitle={`${perf.groupName || "No group"} · ${perf.college || "No college"} · score = 0.5×attendance + 0.5×projects`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Attendance %</p>
          <p className="mt-1 text-3xl font-bold text-teal-900">{perf.attendanceRate}%</p>
          <p className="mt-1 text-xs text-slate-500">
            {perf.present} present · {perf.absent} absent · {perf.leave} leave
          </p>
        </div>
        <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-sky-700">Projects completed %</p>
          <p className="mt-1 text-3xl font-bold text-sky-900">{perf.taskCompletionRate}%</p>
          <p className="mt-1 text-xs text-slate-500">
            {perf.doneTasks}/{perf.totalTasks} done
            {perf.submittedTasks ? ` · ${perf.submittedTasks} awaiting review` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-green-100 bg-gradient-to-br from-green-50 to-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-green-700">Overall score</p>
          <p className="mt-1 text-3xl font-bold text-green-900">{perf.score}%</p>
          <p className="mt-1 text-xs text-slate-500">Combined attendance + project completion</p>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">My overall score</h3>
          <p className="mb-1 text-xs text-slate-500">Where you stand on the 0–100 scale</p>
          <ReactECharts option={gaugeOption} style={{ height: 240 }} />
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Attendance vs projects</h3>
          <p className="mb-1 text-xs text-slate-500">Two key % that make up your score</p>
          <ReactECharts option={dualBarOption} style={{ height: 240 }} />
        </div>
      </div>

      <div className="rounded-xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Recent attendance</p>
          <p className="text-xs text-slate-500">Last 14 marked days</p>
        </div>
        <ul className="divide-y px-4">
          {recent.map((r) => (
            <li key={r.date} className="flex items-center justify-between py-2.5 text-sm">
              <span>{formatDate(r.date)}</span>
              <Badge status={r.status} />
            </li>
          ))}
          {recent.length === 0 && <li className="py-4 text-sm text-slate-400">No attendance yet</li>}
        </ul>
      </div>
    </div>
  );
}
