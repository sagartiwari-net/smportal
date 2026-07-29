import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

export function TrainerDashboard() {
  const { user } = useAuth();
  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName}`} subtitle="Trainer workspace" />
      <div className="flex flex-wrap gap-3">
        <Link className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white" to="/trainer/groups">Groups</Link>
        <Link className="rounded-lg border bg-white px-4 py-2 text-sm" to="/trainer/tasks">Tasks / Review</Link>
        <Link className="rounded-lg border bg-white px-4 py-2 text-sm" to="/trainer/attendance">Attendance</Link>
        <Link className="rounded-lg border bg-white px-4 py-2 text-sm" to="/trainer/analytics">Analytics</Link>
      </div>
    </div>
  );
}
