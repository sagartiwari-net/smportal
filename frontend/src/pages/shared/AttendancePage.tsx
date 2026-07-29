import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type RecordRow = {
  id: string;
  date: string;
  status: string;
  intern?: { id: string; user: { fullName: string } };
};

export function AttendancePage() {
  const { user } = useAuth();
  const canMark = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const isIntern = user?.role === "INTERN";
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [filter, setFilter] = useState("All");
  const [groups, setGroups] = useState<{ id: string; name: string; members: { internId: string; intern: { user: { fullName: string } } }[] }[]>([]);
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [internPct, setInternPct] = useState<{ attendanceRate: number; present: number; absent: number; leave: number } | null>(null);

  async function load() {
    const q = filter === "All" ? "" : `?status=${filter}`;
    const { data } = await api.get(`/attendance${q}`);
    setRecords(data.records);
    if (canMark) {
      const g = await api.get("/groups");
      setGroups(g.data.groups);
    }
  }

  useEffect(() => { void load(); }, [filter]);

  useEffect(() => {
    if (!isIntern) return;
    api.get("/analytics/me").then((r) => {
      const p = r.data.performance;
      setInternPct({
        attendanceRate: p.attendanceRate,
        present: p.present,
        absent: p.absent,
        leave: p.leave,
      });
    }).catch(() => {});
  }, [isIntern]);

  const members = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    return g?.members || [];
  }, [groups, groupId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const entries = members.map((m) => ({
      internId: m.internId,
      status: marks[m.internId] || "PRESENT",
    }));
    if (!entries.length) return;
    await api.post("/attendance/mark", { date, entries });
    await load();
  }

  const filtered = records;

  return (
    <div>
      <PageHeader title={isIntern ? "My Attendance" : "Attendance"} subtitle="Present / Absent / Leave / Week off" />

      {isIntern && internPct && (
        <div className="mb-6 rounded-xl border border-teal-100 bg-teal-50/40 p-4 sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Your attendance %</p>
            <p className="mt-1 text-3xl font-bold text-teal-900">{internPct.attendanceRate}%</p>
          </div>
          <p className="mt-2 text-sm text-slate-600 sm:mt-0">
            {internPct.present} present · {internPct.absent} absent · {internPct.leave} leave
            <span className="block text-xs text-slate-400">(Week offs are not counted against attendance %)</span>
          </p>
        </div>
      )}

      {canMark && (
        <form onSubmit={save} className="mb-8 space-y-3 rounded-xl border bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <input type="date" className="rounded-lg border px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
            <select className="rounded-lg border px-3 py-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
              <option value="">Select group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.internId} className="flex items-center justify-between gap-2 text-sm">
                <span>{m.intern.user.fullName}</span>
                <select className="rounded-lg border px-2 py-1" value={marks[m.internId] || "PRESENT"} onChange={(e) => setMarks({ ...marks, [m.internId]: e.target.value })}>
                  <option value="PRESENT">Present</option>
                  <option value="ABSENT">Absent</option>
                  <option value="LEAVE">Leave</option>
                  <option value="WEEK_OFF">Week off</option>
                </select>
              </div>
            ))}
          </div>
          <button className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">Save attendance</button>
        </form>
      )}

      {isIntern && (
        <div className="mb-4">
          <label className="text-sm text-slate-600">Filter By:{" "}
            <select className="rounded-lg border px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="All">All</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="LEAVE">Leave</option>
              <option value="WEEK_OFF">Week off</option>
            </select>
          </label>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-slate-500">
            <tr>
              {!isIntern && <th className="px-4 py-3">Intern</th>}
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                {!isIntern && <td className="px-4 py-3">{r.intern?.user.fullName || "—"}</td>}
                <td className="px-4 py-3">{formatDate(r.date)}</td>
                <td className="px-4 py-3"><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-sm text-slate-500">No records.</p>}
      </div>
    </div>
  );
}
