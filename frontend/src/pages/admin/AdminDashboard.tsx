import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";

export function AdminDashboard() {
  const { user } = useAuth();
  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName}`}
        subtitle="Trusted Admin — manage HR, admins, and full system"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link className="rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm text-white" to="/admin/users">
          Users & Trusted Admins
        </Link>
        <Link className="rounded-lg border bg-white px-4 py-2.5 text-center text-sm" to="/admin/colleges">
          Colleges
        </Link>
        <Link className="rounded-lg border bg-white px-4 py-2.5 text-center text-sm" to="/admin/analytics">
          Analytics
        </Link>
      </div>
    </div>
  );
}
