import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { AuthPage, ChangePassword } from './pages/AuthPages';
import { Loading, PageHeader } from './components/ui';
import type { Role } from './types';
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AssetsPage = lazy(() => import('./pages/AssetsPage').then((m) => ({ default: m.AssetsPage })));
const AssetDetailPage = lazy(() =>
  import('./pages/AssetsPage').then((m) => ({ default: m.AssetDetailPage })),
);
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const EmployeeDetailPage = lazy(() =>
  import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeeDetailPage })),
);
const TransactionsPage = lazy(() =>
  import('./pages/OperationsPages').then((m) => ({ default: m.TransactionsPage })),
);
const OffboardingPage = lazy(() =>
  import('./pages/OperationsPages').then((m) => ({ default: m.OffboardingPage })),
);
const OffboardingDetailPage = lazy(() =>
  import('./pages/OperationsPages').then((m) => ({ default: m.OffboardingDetailPage })),
);
const RepairsPage = lazy(() => import('./pages/ServicePages').then((m) => ({ default: m.RepairsPage })));
const RequestsPage = lazy(() => import('./pages/ServicePages').then((m) => ({ default: m.RequestsPage })));
const MasterDataPage = lazy(() => import('./pages/AdminPages').then((m) => ({ default: m.MasterDataPage })));
const UsersPage = lazy(() => import('./pages/AdminPages').then((m) => ({ default: m.UsersPage })));
const AuditLogsPage = lazy(() => import('./pages/AdminPages').then((m) => ({ default: m.AuditLogsPage })));
const SettingsPage = lazy(() => import('./pages/AdminPages').then((m) => ({ default: m.SettingsPage })));
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
function Protected({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="initial-loading">
        <Loading />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route element={<Protected />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="assets/:id" element={<AssetDetailPage />} />
            <Route path="profile" element={<EmployeeDetailPage profile />} />
            <Route path="change-password" element={<ChangePassword />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route element={<Protected roles={['ADMIN', 'ASSET_MANAGER']} />}>
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="employees/:id" element={<EmployeeDetailPage />} />
              <Route path="assignments" element={<TransactionsPage kind="assignments" />} />
              <Route path="transfers" element={<TransactionsPage kind="transfers" />} />
              <Route path="returns" element={<TransactionsPage kind="returns" />} />
              <Route path="movements" element={<TransactionsPage kind="movements" />} />
              <Route path="repairs" element={<RepairsPage />} />
              <Route path="maintenance" element={<RepairsPage initialTab="maintenance" />} />
              <Route path="offboarding" element={<OffboardingPage />} />
              <Route path="offboarding/:id" element={<OffboardingDetailPage />} />
              <Route path="categories" element={<MasterDataPage kind="categories" />} />
              <Route path="departments" element={<MasterDataPage kind="departments" />} />
              <Route path="locations" element={<MasterDataPage kind="locations" />} />
              <Route path="reports" element={<ReportsPage />} />
            </Route>
            <Route element={<Protected roles={['ADMIN']} />}>
              <Route path="users" element={<UsersPage />} />
              <Route path="audit-logs" element={<AuditLogsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route
              path="*"
              element={
                <>
                  <PageHeader
                    title="Page not found"
                    description="This page may have moved or is no longer available."
                  />
                  <a href="/" className="btn primary">
                    Back to overview
                  </a>
                </>
              }
            />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
