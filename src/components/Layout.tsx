import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Menu,
  X,
  LogOut,
  AlertTriangle,
  Map as MapIcon,
  History,
  UserCircle,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Boxes,
  UsersRound,
} from 'lucide-react';
import useStore from '../store/useStore';
import { useAuth } from '../contexts/AuthContext';
import { useLocationSharing } from '../hooks/useLiveLocation';
import { useIsMobile } from '../hooks/useIsMobile';
import { useMyInventoryAccess } from '../hooks/useInventoryAccess';
import NotificationBell from './NotificationBell';
import HelpMenu from './HelpMenu';
import GlobalSearch from './GlobalSearch';
import Footer from './Footer';
import MobileShell from './mobile/MobileShell';
import { SlotProvider, CommandBarSlot, ContextPanelSlot } from './layout/Slots';
import { PanelToggleContext } from '../contexts/PanelToggleContext';
import { Z } from '../lib/floating';
import jharkhandEmblem from '../assets/jharkhand-emblem.png';

type Section = { key: string; to: string; label: string; icon: React.ReactNode };

const iconCls = 'w-5 h-5 flex-shrink-0';

function directorSections(): Section[] {
  return [
    { key: 'dashboard', to: '/director', label: 'Dashboard', icon: <LayoutDashboard className={iconCls} /> },
    { key: 'tasks', to: '/director/tasks', label: 'Task registry', icon: <ClipboardList className={iconCls} /> },
    { key: 'incidents', to: '/director/incidents', label: 'Incident reports', icon: <AlertTriangle className={iconCls} /> },
    { key: 'map', to: '/director/map', label: 'Range map', icon: <MapIcon className={iconCls} /> },
    { key: 'groups', to: '/director/groups', label: 'Task Groups', icon: <UsersRound className={iconCls} /> },
    { key: 'inventory', to: '/director/inventory', label: 'Inventory', icon: <Boxes className={iconCls} /> },
    { key: 'users', to: '/director/users', label: 'Personnel', icon: <Users className={iconCls} /> },
    { key: 'audit', to: '/director/audit', label: 'System audit', icon: <History className={iconCls} /> },
  ];
}

// Inventory is capability-based (an active inventory_location_staff
// assignment), not role-based, same as the guard shell's bottom-nav entry
// — so unlike the rest of this static list, it's only included when the
// signed-in officer actually has access.
function officerSections(hasInventoryAccess: boolean): Section[] {
  return [
    { key: 'dashboard', to: '/officer', label: 'Dashboard', icon: <LayoutDashboard className={iconCls} /> },
    { key: 'tasks', to: '/officer/tasks', label: 'Task registry', icon: <ClipboardList className={iconCls} /> },
    { key: 'incidents', to: '/officer/incidents', label: 'Incident reports', icon: <AlertTriangle className={iconCls} /> },
    { key: 'map', to: '/officer/map', label: 'Range map', icon: <MapIcon className={iconCls} /> },
    { key: 'groups', to: '/officer/groups', label: 'Task Groups', icon: <UsersRound className={iconCls} /> },
    ...(hasInventoryAccess ? [{ key: 'inventory', to: '/officer/inventory', label: 'Inventory', icon: <Boxes className={iconCls} /> }] : []),
    { key: 'audit', to: '/officer/audit', label: 'System audit', icon: <History className={iconCls} /> },
  ];
}

const SECTION_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  tasks: 'Task registry',
  incidents: 'Incident reports',
  map: 'Range map',
  groups: 'Task Groups',
  inventory: 'Inventory',
  users: 'Personnel',
  audit: 'System audit',
  profile: 'My profile',
  stock: 'Stock',
  requests: 'Requests',
  purchases: 'Purchases',
  transactions: 'Transactions',
  reports: 'Inventory reports',
};

// Which rail section a given path belongs to (task detail lives under Tasks).
function sectionForPath(pathname: string, base: string): string {
  const rest = pathname.slice(base.length).replace(/^\//, '');
  const seg = rest.split('/')[0];
  if (!seg) return 'dashboard';
  if (seg === 'tasks') return 'tasks';
  return seg; // incidents | map | users | audit | profile
}

function UserMenu({ base, onLogout }: { base: string; onLogout: () => void }) {
  const currentUser = useStore((s) => s.currentUser);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  // Avatar + chevron sit inside a single <button> — one coherent control,
  // not two separate hit targets that happen to sit next to each other.
  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-9 pl-1.5 pr-1 rounded hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        title="Account menu"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-full bg-white/15 text-white flex items-center justify-center text-xs font-semibold">
          {currentUser?.avatarInitials}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-white/70 hidden sm:block" />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label="Account menu"
          className="fixed w-60 bg-white rounded-md shadow-pop border border-n-30 py-1 animate-slide-down"
          style={{ top: pos.top, right: pos.right, zIndex: Z.dropdown }}
        >
          <div className="px-3 py-2.5 border-b border-n-30">
            <div className="text-13 font-semibold text-n-100 truncate">{currentUser?.name}</div>
            <div className="text-xs text-n-80 truncate">{currentUser?.designation}</div>
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate(`${base}/profile`); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-13 text-n-90 hover:bg-n-20 transition-colors"
          >
            <UserCircle className="w-4 h-4 text-n-70" />
            My profile
          </button>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-13 text-signal-red hover:bg-signal-red-bg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function GlobalHeader({
  onToggleNav,
  base,
}: {
  onToggleNav: () => void;
  base: string;
}) {
  const { logoutFromSupabase } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutFromSupabase();
    navigate('/login', { replace: true });
  };

  return (
    <header
      className="flex-shrink-0 bg-ptr-green text-white flex items-center gap-2 pl-1.5 pr-2 sm:pr-3"
      style={{ height: 'calc(48px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Left — identity */}
      <button
        onClick={onToggleNav}
        className="lg:hidden w-10 h-10 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2.5 min-w-0 pl-1">
        <img src={jharkhandEmblem} alt="" className="w-7 h-7 flex-shrink-0" />
        <div className="leading-tight min-w-0 hidden xs:block">
          <div className="text-[10.5px] text-white/70 tracking-wide uppercase leading-none">Government of Jharkhand</div>
          <div className="text-13 font-semibold text-white leading-tight truncate">Palamau Tiger Reserve</div>
        </div>
        <span className="text-13 font-semibold text-white xs:hidden">Smart Forester</span>
        <span className="hidden lg:block text-xs text-white/60 border-l border-white/20 pl-2.5 ml-1 truncate">
          Smart Forester
        </span>
      </div>

      {/* Center — global search */}
      <div className="hidden md:flex flex-1 justify-center px-4">
        <GlobalSearch base={base} />
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-0.5 ml-auto md:ml-0">
        <HelpMenu />
        <NotificationBell />
        <UserMenu base={base} onLogout={handleLogout} />
      </div>
    </header>
  );
}

function IconRail({ sections, currentSection }: { sections: Section[]; currentSection: string }) {
  return (
    <nav aria-label="Primary" className="hidden lg:flex flex-col items-center w-12 flex-shrink-0 bg-n-20 border-r border-n-30 py-1.5 gap-0.5">
      {sections.map((s) => {
        const active = s.key === currentSection;
        return (
          <NavLink
            key={s.key}
            to={s.to}
            title={s.label}
            aria-label={s.label}
            className="group relative w-10 h-10 flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ptr-accent/50"
          >
            {/* 3px dark-green left indicator on the active section */}
            <span
              className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-ptr-green transition-opacity ${
                active ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <span
              className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${
                active ? 'text-ptr-green-dark bg-ptr-green/10' : 'text-n-80 group-hover:bg-n-30 group-hover:text-n-100'
              }`}
            >
              {s.icon}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function AdminLayout({ sections, base }: { sections: Section[]; base: string }) {
  const { logoutFromSupabase } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('ptr-panel-collapsed') === '1'; } catch { return false; }
  });

  const currentSection = sectionForPath(location.pathname, base);

  const togglePanel = () => {
    setPanelCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('ptr-panel-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  // A page's command-bar "Filter" button only ever opens the panel (never
  // collapses it) — closing is still the dedicated PanelLeftClose control.
  const openPanel = () => {
    setPanelCollapsed(false);
    try { localStorage.setItem('ptr-panel-collapsed', '0'); } catch { /* ignore */ }
  };

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logoutFromSupabase();
    navigate('/login', { replace: true });
  };

  return (
    <PanelToggleContext.Provider value={{ collapsed: panelCollapsed, toggle: openPanel }}>
    <div className="h-dvh flex flex-col bg-white overflow-hidden">
      <GlobalHeader onToggleNav={() => setNavOpen(true)} base={base} />

      <div className="flex flex-1 overflow-hidden">
        <IconRail sections={sections} currentSection={currentSection} />

        {/* Mobile drawer scrim */}
        {navOpen && (
          <div
            className="fixed inset-0 top-12 bg-black/30 z-30 lg:hidden"
            onClick={() => setNavOpen(false)}
            style={{ animation: 'fadeIn 0.12s ease-out' }}
          />
        )}

        {/* Contextual navigation panel — static 220px column on desktop,
            slide-in drawer (with the labelled section nav prepended) on mobile.
            One DOM node so the page's portalled filters live in a single slot. */}
        <aside
          className={`bg-n-10 border-r border-n-30 flex flex-col z-40
            fixed top-12 bottom-0 left-0 w-[280px] transition-transform duration-150
            lg:static lg:top-0 lg:translate-x-0 lg:transition-[width] lg:duration-150 lg:overflow-hidden
            ${panelCollapsed ? 'lg:w-0 lg:border-r-0' : 'lg:w-[220px]'}
            ${navOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full lg:translate-x-0'}`}
        >
          <div className="flex items-center justify-between px-4 h-11 border-b border-n-30 flex-shrink-0 lg:w-[220px]">
            <h2 className="text-13 font-semibold text-n-100">{SECTION_TITLES[currentSection] ?? 'Menu'}</h2>
            <button
              onClick={togglePanel}
              className="hidden lg:flex w-8 h-8 -mr-1.5 items-center justify-center rounded text-n-70 hover:bg-n-20 hover:text-n-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ptr-accent/40"
              title="Collapse panel"
              aria-label="Collapse navigation panel"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <button
              onClick={() => setNavOpen(false)}
              className="lg:hidden w-8 h-8 -mr-1.5 flex items-center justify-center rounded text-n-70 hover:bg-n-20"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile-only labelled section nav (desktop uses the icon rail). */}
          <nav className="lg:hidden px-2 py-2 border-b border-n-30 space-y-0.5">
            {sections.map((s) => {
              const active = s.key === currentSection;
              return (
                <NavLink
                  key={s.key}
                  to={s.to}
                  className={`flex items-center gap-3 px-2.5 h-10 rounded text-13 transition-colors ${
                    active ? 'bg-ptr-green/10 text-ptr-green font-semibold' : 'text-n-90 hover:bg-n-20'
                  }`}
                >
                  {s.icon}
                  {s.label}
                </NavLink>
              );
            })}
          </nav>

          {/* Page-provided views/filters portal in here. */}
          <div className="flex-1 overflow-y-auto lg:w-[220px]">
            <ContextPanelSlot className="p-3" />
          </div>
        </aside>

        {/* Workspace column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Command bar */}
          <div className="flex-shrink-0 h-11 bg-white border-b border-n-30 flex items-center gap-1 px-2 sm:px-3 overflow-x-auto">
            {panelCollapsed && (
              <button
                onClick={togglePanel}
                className="hidden lg:flex w-8 h-8 items-center justify-center rounded text-n-70 hover:bg-n-20 hover:text-n-100 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ptr-accent/40"
                title="Expand panel"
                aria-label="Expand navigation panel"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            {panelCollapsed && <span className="hidden lg:block w-px h-5 bg-n-30 mx-1 flex-shrink-0" />}
            <CommandBarSlot className="flex items-center gap-1 min-w-max" />
          </div>

          {/* Continuous white workspace */}
          <main className="flex-1 overflow-y-auto bg-white flex flex-col">
            <div className="flex-1">
              <Outlet />
            </div>
            <Footer />
          </main>
        </div>
      </div>

      {/* Mobile logout affordance lives in the drawer footer for reachability */}
      {navOpen && (
        <button
          onClick={handleLogout}
          className="lg:hidden fixed bottom-0 left-0 w-[280px] z-40 flex items-center gap-2.5 px-4 h-12 bg-n-10 border-t border-r border-n-30 text-13 font-medium text-signal-red"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      )}
    </div>
    </PanelToggleContext.Provider>
  );
}

function GuardLayout() {
  const currentUser = useStore((s) => s.currentUser);
  const { logoutFromSupabase } = useAuth();
  const navigate = useNavigate();
  const { hasInventoryAccess } = useMyInventoryAccess();
  useLocationSharing();

  const handleLogout = async () => {
    await logoutFromSupabase();
    navigate('/login', { replace: true });
  };

  const navItem = (to: string, end: boolean, icon: React.ReactNode, label: string) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
          isActive ? 'text-ptr-green' : 'text-n-70'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );

  return (
    <SlotProvider>
    <div className="min-h-dvh bg-white flex flex-col">
      <div className="sticky top-0 z-30">
        {/* Compact green identity header */}
        <header
          className="bg-ptr-green text-white flex items-center gap-2.5 px-3"
          style={{ height: 'calc(48px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
        >
          <img src={jharkhandEmblem} alt="" className="w-7 h-7 flex-shrink-0" />
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-[10.5px] text-white/70 uppercase tracking-wide leading-none">Government of Jharkhand</div>
            <div className="text-13 font-semibold leading-tight truncate">Palamau Tiger Reserve</div>
          </div>
          <div className="text-white/90">
            <NotificationBell />
          </div>
          <NavLink
            to="/guard/profile"
            className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-xs font-semibold flex-shrink-0"
            title="My profile"
          >
            {currentUser?.avatarInitials}
          </NavLink>
        </header>
        {/* Identity strip */}
        <div className="bg-n-10 border-b border-n-30 px-3 py-1.5">
          <p className="text-13 text-n-90">
            <span className="font-semibold">{currentUser?.name}</span>
            {currentUser?.designation && <span className="text-n-70"> · {currentUser.designation}</span>}
          </p>
        </div>
        {/* Contextual command bar — same slot/portal system AdminLayout uses,
            so pages like IncidentLog get their bulk-action toolbar here too.
            The slot div itself (not a wrapper) carries the sizing, so
            `empty:` genuinely reflects whether a page portalled anything
            into it — pages that never call <CommandBar> (e.g. guard's own
            task list) get a true zero-height, borderless node and look
            exactly as before. */}
        <CommandBarSlot className="empty:h-0 empty:border-0 empty:overflow-hidden h-11 bg-white border-b border-n-30 flex items-center gap-1 px-3 overflow-x-auto" />
      </div>

      <main className="flex-1" style={{ paddingBottom: 'calc(3.75rem + env(safe-area-inset-bottom))' }}>
        <Outlet />
        <Footer />
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-n-30 flex items-stretch z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navItem('/guard', true, <ClipboardList className="w-5 h-5" />, 'My tasks')}
        {navItem('/guard/incidents', false, <AlertTriangle className="w-5 h-5" />, 'Incidents')}
        {navItem('/guard/map', false, <MapIcon className="w-5 h-5" />, 'Map')}
        {/* Inventory is an additional capability, not a Field Ops module —
            shown only for a guard with at least one active location
            assignment, on top of (not instead of) their normal nav. */}
        {hasInventoryAccess && navItem('/guard/inventory', false, <Boxes className="w-5 h-5" />, 'Inventory')}
        {navItem('/guard/profile', false, <UserCircle className="w-5 h-5" />, 'Profile')}
        <button
          onClick={handleLogout}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-n-70 hover:text-signal-red transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Log out
        </button>
      </nav>
    </div>
    </SlotProvider>
  );
}

function roleBase(role: string | undefined): string {
  if (role === 'director') return '/director';
  if (role === 'range_officer') return '/officer';
  return '/guard';
}

export default function Layout() {
  const currentUser = useStore((s) => s.currentUser);
  const isMobile = useIsMobile();
  // Cheap to call unconditionally — the query is disabled for a director
  // (useMyInventoryAccess), so this is a no-op fetch for every role that
  // doesn't need it, matching the same hook GuardLayout/MobileShell already
  // call for their own Inventory nav entries.
  const { hasInventoryAccess } = useMyInventoryAccess();

  // Below 768px every Field Ops role shares the same bottom-nav shell
  // (Home / Tasks / Incidents / Map / More). Inventory is not a separate
  // shell — an assigned guard gets it inside this same shell's More sheet
  // (see MobileShell.tsx). The desktop icon-rail/drawer chrome below is
  // untouched and only ever mounts at >=768px.
  if (isMobile) {
    return <MobileShell base={roleBase(currentUser?.role)} role={currentUser?.role ?? 'guard'} />;
  }

  if (currentUser?.role === 'director') {
    return (
      <SlotProvider>
        <AdminLayout sections={directorSections()} base="/director" />
      </SlotProvider>
    );
  }

  if (currentUser?.role === 'range_officer') {
    return (
      <SlotProvider>
        <AdminLayout sections={officerSections(hasInventoryAccess)} base="/officer" />
      </SlotProvider>
    );
  }

  return <GuardLayout />;
}
