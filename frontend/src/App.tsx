import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/login/LoginPage";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { HrDashboard } from "./pages/hr/HrDashboard";
import { UsersPage } from "./pages/shared/UsersPage";
import { CollegesPage } from "./pages/shared/CollegesPage";
import { TrainerDashboard } from "./pages/trainer/TrainerDashboard";
import { InternDashboard } from "./pages/intern/InternDashboard";
import { InternPerformancePage } from "./pages/intern/InternPerformancePage";
import { CollegeDashboard } from "./pages/college/CollegeDashboard";
import { GroupsPage } from "./pages/shared/GroupsPage";
import { TasksPage } from "./pages/shared/TasksPage";
import { AttendancePage } from "./pages/shared/AttendancePage";
import { AnalyticsPage } from "./pages/shared/AnalyticsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/colleges" element={<CollegesPage />} />
              <Route path="/admin/groups" element={<GroupsPage basePath="/admin" />} />
              <Route path="/admin/tasks" element={<TasksPage />} />
              <Route path="/admin/attendance" element={<AttendancePage />} />
              <Route path="/admin/analytics" element={<AnalyticsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["HR"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/hr/dashboard" element={<HrDashboard />} />
              <Route path="/hr/users" element={<UsersPage />} />
              <Route path="/hr/colleges" element={<CollegesPage />} />
              <Route path="/hr/groups" element={<GroupsPage basePath="/hr" />} />
              <Route path="/hr/tasks" element={<TasksPage />} />
              <Route path="/hr/attendance" element={<AttendancePage />} />
              <Route path="/hr/analytics" element={<AnalyticsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["TRAINER"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/trainer/dashboard" element={<TrainerDashboard />} />
              <Route path="/trainer/groups" element={<GroupsPage basePath="/trainer" />} />
              <Route path="/trainer/tasks" element={<TasksPage />} />
              <Route path="/trainer/attendance" element={<AttendancePage />} />
              <Route path="/trainer/analytics" element={<AnalyticsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["INTERN"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/intern/dashboard" element={<InternDashboard />} />
              <Route path="/intern/performance" element={<InternPerformancePage />} />
              <Route path="/intern/tasks" element={<TasksPage />} />
              <Route path="/intern/attendance" element={<AttendancePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["COLLEGE"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/college/dashboard" element={<CollegeDashboard />} />
              <Route path="/college/groups" element={<GroupsPage basePath="/college" />} />
              <Route path="/college/tasks" element={<TasksPage />} />
              <Route path="/college/attendance" element={<AttendancePage />} />
              <Route path="/college/analytics" element={<AnalyticsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
