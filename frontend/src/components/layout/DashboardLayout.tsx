import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABEL, type Role } from "../../lib/roles";

type NavItem = { to: string; label: string };

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/users", label: "Users" },
    { to: "/admin/colleges", label: "Colleges" },
    { to: "/admin/groups", label: "Groups" },
    { to: "/admin/tasks", label: "Tasks" },
    { to: "/admin/attendance", label: "Attendance" },
    { to: "/admin/analytics", label: "Analytics" },
  ],
  HR: [
    { to: "/hr/dashboard", label: "Dashboard" },
    { to: "/hr/users", label: "Users" },
    { to: "/hr/colleges", label: "Colleges" },
    { to: "/hr/groups", label: "Groups" },
    { to: "/hr/tasks", label: "Tasks" },
    { to: "/hr/attendance", label: "Attendance" },
    { to: "/hr/analytics", label: "Analytics" },
  ],
  TRAINER: [
    { to: "/trainer/dashboard", label: "Dashboard" },
    { to: "/trainer/groups", label: "My Groups" },
    { to: "/trainer/tasks", label: "Tasks" },
    { to: "/trainer/attendance", label: "Attendance" },
    { to: "/trainer/analytics", label: "Analytics" },
  ],
  INTERN: [
    { to: "/intern/dashboard", label: "Dashboard Home" },
    { to: "/intern/performance", label: "My Performance" },
    { to: "/intern/tasks", label: "My Tasks" },
    { to: "/intern/attendance", label: "My Attendance" },
  ],
  COLLEGE: [
    { to: "/college/dashboard", label: "Dashboard" },
    { to: "/college/groups", label: "Groups" },
    { to: "/college/tasks", label: "Tasks" },
    { to: "/college/attendance", label: "Attendance" },
    { to: "/college/analytics", label: "Analytics" },
  ],
};

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const nav = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-green-600" />
          <span className="font-semibold text-slate-800">{ROLE_LABEL[user.role]}</span>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV[user.role].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => void onLogout()}
        className="m-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="h-4 w-4" />
        Logout
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-green-600" />
          <span className="text-sm font-semibold text-slate-800">{ROLE_LABEL[user.role]}</span>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close overlay"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:z-0 md:w-60 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>

      <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
