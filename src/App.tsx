import { type ReactNode, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, queryPersister } from './lib/queryClient';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import useStore from './store/useStore';
import { isFieldRole } from './types';
import { useMyInventoryAccess } from './hooks/useInventoryAccess';
import Login from './pages/Login';
import Layout from './components/Layout';
import OfflineBanner from './components/OfflineBanner';
import ptrLogo from './assets/ptr-logo.png';

// Route-level code splitting: a guard never downloads director/officer
// bundles (charts, user management, etc.) and vice versa.
const DirectorDashboard = lazy(() => import('./pages/director/Dashboard'));
const DirectorTaskList = lazy(() => import('./pages/director/TaskList'));
const DirectorUsers = lazy(() => import('./pages/director/Users'));
const OfficerDashboard = lazy(() => import('./pages/officer/Dashboard'));
const OfficerTaskList = lazy(() => import('./pages/officer/TaskList'));
const TaskDetailPage = lazy(() => import('./pages/shared/TaskDetailPage'));
const IncidentLog = lazy(() => import('./pages/shared/IncidentLog'));
const MapView = lazy(() => import('./pages/shared/MapView'));
const AuditLog = lazy(() => import('./pages/shared/AuditLog'));
const Profile = lazy(() => import('./pages/shared/Profile'));
const GuardMyTasks = lazy(() => import('./pages/guard/MyTasks'));
const GuardTaskList = lazy(() => import('./pages/guard/TaskList'));

// Task Groups & Recurring Assignments (Phase 1) — a persistent group layer
// shared across all three role trees. Every route below is the same
// component; RLS (not this routing) is what actually scopes a director to
// every group, an officer to their range's groups, and a field-role user
// to only the groups they belong to.
const TaskGroupsList = lazy(() => import('./pages/shared/TaskGroupsList'));
const TaskGroupDetail = lazy(() => import('./pages/shared/TaskGroupDetail'));
const OccurrenceDetail = lazy(() => import('./pages/shared/OccurrenceDetail'));

// Hospitality Inventory Management (Phase 1) — a domain module shared by
// the director's nested area and (for an assigned guard) a nested area
// under /guard. Not a separate role/shell — see ProtectedInventoryAccess.
const InventoryDashboard = lazy(() => import('./pages/inventory/Dashboard'));
const InventoryItems = lazy(() => import('./pages/inventory/Items'));
const InventoryCategories = lazy(() => import('./pages/inventory/Categories'));
const InventoryLocations = lazy(() => import('./pages/inventory/Locations'));
const InventoryStock = lazy(() => import('./pages/inventory/Stock'));
const InventoryRequests = lazy(() => import('./pages/inventory/Requests'));
const InventoryRequestDetail = lazy(() => import('./pages/inventory/RequestDetail'));
const InventoryPurchases = lazy(() => import('./pages/inventory/Purchases'));
const InventorySales = lazy(() => import('./pages/inventory/Sales'));
const InventoryTransactions = lazy(() => import('./pages/inventory/Transactions'));
const InventoryReports = lazy(() => import('./pages/inventory/Reports'));
const InventoryManagers = lazy(() => import('./pages/inventory/Managers'));

function roleHome(role: string): string {
  if (role === 'director') return '/director';
  if (role === 'range_officer') return '/officer';
  return '/guard';
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-ptr-cream flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-white border border-ptr-cream-dark shadow-sm flex items-center justify-center overflow-hidden animate-pulse">
          <img src={ptrLogo} alt="" className="w-full h-full object-contain p-1" />
        </div>
        <p className="text-sm text-ptr-brown-light">Loading…</p>
      </div>
    </div>
  );
}

function ProtectedDirector({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'director') return <Navigate to={roleHome(user.role)} replace />;
  return <>{children}</>;
}

function ProtectedOfficer({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'range_officer') return <Navigate to={roleHome(user.role)} replace />;
  return <>{children}</>;
}

function ProtectedGuard({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isFieldRole(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return <>{children}</>;
}

// Capability-based, not role-based: Inventory access requires either the
// director role or at least one active inventory_location_staff
// assignment (see useMyInventoryAccess). Guards a route, not a shell — the
// wrapped routes still render inside whichever Layout the outer role-guard
// (ProtectedGuard/ProtectedDirector) already selected, so an assigned
// guard's Inventory pages open inside their normal Guard shell, never a
// separate Inventory-only application.
function ProtectedInventoryAccess({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  const { hasInventoryAccess, isLoading } = useMyInventoryAccess();
  if (loading || isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasInventoryAccess) return <Navigate to={roleHome(user.role)} replace />;
  return <>{children}</>;
}

function Root() {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

// Role-agnostic deep link used by push notification clicks (the service
// worker has no idea which role opened it) — resolves to the same task
// under whichever role-scoped route the signed-in user actually has.
function TaskRedirect() {
  const { loading } = useAuth();
  const user = useStore((s) => s.currentUser);
  const { id } = useParams();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={`${roleHome(user.role)}/tasks/${id}`} replace />;
}

export default function App() {
  // Realtime subscriptions (see useTasks/useNotifications) push live updates,
  // but a phone's OS aggressively suspends or kills a backgrounded app's
  // WebSocket — so any change made while it was in the background (a task
  // assigned, a comment added) never arrives over that dead connection, and
  // there's no missed-event replay. Reopening/foregrounding the app doesn't
  // necessarily reload the page either, so nothing re-fetches on its own.
  // Refetching everything whenever the tab becomes visible again (or comes
  // back online) closes that gap without needing a manual refresh.
  useEffect(() => {
    const refetchAll = () => { void queryClient.invalidateQueries(); };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refetchAll(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', refetchAll);
    window.addEventListener('pageshow', refetchAll);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', refetchAll);
      window.removeEventListener('pageshow', refetchAll);
    };
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister }}
      onSuccess={() => {
        // Replay any mutations (progress updates, start/complete, etc.)
        // that were queued while offline and survived a page reload.
        void queryClient.resumePausedMutations().then(() => {
          void queryClient.invalidateQueries();
        });
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <OfflineBanner />
          <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Root />} />
            <Route path="/login" element={<Login />} />
            <Route path="/tasks/:id" element={<TaskRedirect />} />

            {/* Director */}
            <Route
              path="/director"
              element={
                <ProtectedDirector>
                  <Layout />
                </ProtectedDirector>
              }
            >
              <Route index element={<DirectorDashboard />} />
              <Route path="tasks" element={<DirectorTaskList />} />
              <Route path="tasks/:id" element={<TaskDetailPage />} />
              <Route path="users" element={<DirectorUsers />} />
              <Route path="incidents" element={<IncidentLog />} />
              <Route path="map" element={<MapView />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="profile" element={<Profile />} />

              <Route path="groups" element={<TaskGroupsList />} />
              <Route path="groups/:id" element={<TaskGroupDetail />} />
              <Route path="groups/:id/occurrences/:occId" element={<OccurrenceDetail />} />

              {/* Hospitality Inventory Management — nested area with its own
                  internal pages; opens from the icon rail / mobile More sheet.
                  Director always has full access, so no extra capability
                  guard is needed here (ProtectedDirector already covers it). */}
              <Route path="inventory" element={<InventoryDashboard />} />
              <Route path="inventory/items" element={<InventoryItems />} />
              <Route path="inventory/categories" element={<InventoryCategories />} />
              <Route path="inventory/locations" element={<InventoryLocations />} />
              <Route path="inventory/stock" element={<InventoryStock />} />
              <Route path="inventory/requests" element={<InventoryRequests />} />
              <Route path="inventory/requests/:id" element={<InventoryRequestDetail />} />
              <Route path="inventory/purchases" element={<InventoryPurchases />} />
              <Route path="inventory/sales" element={<InventorySales />} />
              <Route path="inventory/transactions" element={<InventoryTransactions />} />
              <Route path="inventory/reports" element={<InventoryReports />} />
              <Route path="inventory/managers" element={<InventoryManagers />} />
            </Route>

            {/* Range Officer */}
            <Route
              path="/officer"
              element={
                <ProtectedOfficer>
                  <Layout />
                </ProtectedOfficer>
              }
            >
              <Route index element={<OfficerDashboard />} />
              <Route path="tasks" element={<OfficerTaskList />} />
              <Route path="tasks/:id" element={<TaskDetailPage />} />
              <Route path="incidents" element={<IncidentLog />} />
              <Route path="map" element={<MapView />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="profile" element={<Profile />} />

              <Route path="groups" element={<TaskGroupsList />} />
              <Route path="groups/:id" element={<TaskGroupDetail />} />
              <Route path="groups/:id/occurrences/:occId" element={<OccurrenceDetail />} />

              {/* Inventory is an additional capability, not a separate
                  shell — same as the guard block below. The mobile "More"
                  sheet already links here for any role with access
                  (MobileShell.tsx); this was the missing route half of
                  that link for range officers specifically. Director-only
                  catalog pages (items/categories/locations/managers) are
                  deliberately not included, matching the guard block. */}
              <Route path="inventory" element={<ProtectedInventoryAccess><Outlet /></ProtectedInventoryAccess>}>
                <Route index element={<InventoryDashboard />} />
                <Route path="stock" element={<InventoryStock />} />
                <Route path="requests" element={<InventoryRequests />} />
                <Route path="requests/:id" element={<InventoryRequestDetail />} />
                <Route path="purchases" element={<InventoryPurchases />} />
                <Route path="transactions" element={<InventoryTransactions />} />
                <Route path="reports" element={<InventoryReports />} />
              </Route>
            </Route>

            {/* Guard — Inventory is an additional capability for guards with
                an active location assignment, not a separate role/shell.
                Nested under the same Layout/ProtectedGuard as the rest of
                Field Ops; the inner "inventory" route adds the extra
                capability check on top. */}
            <Route
              path="/guard"
              element={
                <ProtectedGuard>
                  <Layout />
                </ProtectedGuard>
              }
            >
              <Route index element={<GuardMyTasks />} />
              <Route path="tasks" element={<GuardTaskList />} />
              <Route path="tasks/:id" element={<TaskDetailPage />} />
              <Route path="incidents" element={<IncidentLog />} />
              <Route path="map" element={<MapView />} />
              <Route path="profile" element={<Profile />} />

              {/* Read-only for a field-role user unless they're a Task
                  Group coordinator/member with post rights — RLS scopes
                  visibility to groups/occurrences they actually belong to;
                  canManageTaskGroups (director/officer only) hides the
                  create/manage controls here, it doesn't grant them. */}
              <Route path="groups" element={<TaskGroupsList />} />
              <Route path="groups/:id" element={<TaskGroupDetail />} />
              <Route path="groups/:id/occurrences/:occId" element={<OccurrenceDetail />} />

              <Route path="inventory" element={<ProtectedInventoryAccess><Outlet /></ProtectedInventoryAccess>}>
                <Route index element={<InventoryDashboard />} />
                <Route path="stock" element={<InventoryStock />} />
                <Route path="requests" element={<InventoryRequests />} />
                <Route path="requests/:id" element={<InventoryRequestDetail />} />
                <Route path="purchases" element={<InventoryPurchases />} />
                <Route path="transactions" element={<InventoryTransactions />} />
                <Route path="reports" element={<InventoryReports />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
