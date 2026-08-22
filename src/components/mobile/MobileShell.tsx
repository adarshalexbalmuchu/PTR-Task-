import { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Home, ClipboardList, AlertTriangle, Map as MapIcon, MoreHorizontal, Search,
  UserCircle, Users, History, HelpCircle, LogOut, X, Wifi, WifiOff, RefreshCw, AlertCircle, Check, Boxes, UsersRound,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useIncidentQueue } from '../../hooks/useIncidentQueue';
import { useLocationSharing } from '../../hooks/useLiveLocation';
import { useMyInventoryAccess } from '../../hooks/useInventoryAccess';
import { MobileOverlayProvider, useMobileOverlay } from '../../contexts/MobileOverlayContext';
import { formatRelative } from '../../utils/formatters';
import NotificationBell from '../NotificationBell';
import BottomSheet from './BottomSheet';
import MobileHelpSheet from './MobileHelpSheet';
import MobileSearchOverlay from './MobileSearchOverlay';
import jharkhandEmblem from '../../assets/jharkhand-emblem.png';

const SYNC_PILL_CFG = {
  offline: { icon: WifiOff, label: 'Offline', cls: 'text-white bg-white/15' },
  syncing: { icon: RefreshCw, label: 'Syncing', cls: 'text-white bg-white/15', spin: true },
  'sync-failed': { icon: AlertCircle, label: 'Sync failed', cls: 'text-white bg-signal-red/90' },
  synced: { icon: Wifi, label: 'Synced', cls: 'text-white/80 bg-white/10' },
} as const;

function SyncPill({ onOpen }: { onOpen: (trigger: HTMLElement) => void }) {
  const { state, lastSynced } = useSyncStatus();
  const cfg = SYNC_PILL_CFG[state];
  const Icon = cfg.icon;
  // A persistent status indicator at every width — the label collapses away
  // on narrow phones (iPhone SE/13 etc.) but the icon (and its colour) is
  // always visible, since sync state is a core, always-on signal, not
  // something that can quietly disappear on a smaller screen. Tapping it
  // opens the real sync-detail sheet (see SyncDetailsSheet below).
  return (
    <button
      onClick={(e) => onOpen(e.currentTarget)}
      className={`inline-flex items-center gap-1 h-6 px-1.5 xs:px-2 rounded-full text-[11px] font-medium flex-shrink-0 ${cfg.cls}`}
      title={lastSynced ? `Last synced ${new Date(lastSynced).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : cfg.label}
      aria-label="Sync status"
    >
      <Icon className={`w-3 h-3 ${'spin' in cfg && cfg.spin ? 'animate-spin' : ''}`} />
      <span className="hidden xs:inline">{cfg.label}</span>
    </button>
  );
}

function SyncDetailsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, isOnline, pendingCount, failedCount, lastSynced } = useSyncStatus();
  const { queued } = useIncidentQueue();
  const queryClient = useQueryClient();
  const totalPending = pendingCount + queued.filter((q) => q.status !== 'failed').length;
  const totalFailed = failedCount + queued.filter((q) => q.status === 'failed').length;

  const retry = () => {
    void queryClient.resumePausedMutations();
    void queryClient.invalidateQueries();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Sync status">
      <div className="p-4 space-y-3">
        {!isOnline ? (
          <div className="flex items-start gap-2.5">
            <WifiOff className="w-5 h-5 text-signal-amber flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[15px] font-semibold text-n-100">Offline</p>
              <p className="text-13 text-n-70 mt-0.5">
                {totalPending + totalFailed > 0 ? `${totalPending + totalFailed} change${totalPending + totalFailed === 1 ? '' : 's'} waiting to sync` : 'Changes made now will sync once you’re back online.'}
              </p>
            </div>
          </div>
        ) : state === 'sync-failed' ? (
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-signal-red flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-n-100">Sync failed</p>
              <p className="text-13 text-n-70 mt-0.5">{totalFailed} change{totalFailed === 1 ? '' : 's'} could not be sent.</p>
              <button onClick={retry} className="btn-secondary h-9 text-13 mt-2">Retry</button>
            </div>
          </div>
        ) : state === 'syncing' ? (
          <div className="flex items-start gap-2.5">
            <RefreshCw className="w-5 h-5 text-ptr-green flex-shrink-0 mt-0.5 animate-spin" />
            <div>
              <p className="text-[15px] font-semibold text-n-100">Syncing…</p>
              <p className="text-13 text-n-70 mt-0.5">{totalPending} change{totalPending === 1 ? '' : 's'} being sent.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5">
            <Check className="w-5 h-5 text-signal-green flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[15px] font-semibold text-n-100">All changes synced</p>
              <p className="text-13 text-n-70 mt-0.5">
                {lastSynced ? `Last synced ${formatRelative(new Date(lastSynced).toISOString())}` : 'Nothing waiting to sync.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

interface MoreItem {
  label: string;
  icon: React.ReactNode;
  to?: string;
  href?: string;
  danger?: boolean;
  onClick?: () => void;
}

function LogoutConfirmSheet({ open, onClose, onConfirm, pendingCount }: { open: boolean; onClose: () => void; onConfirm: () => void; pendingCount: number }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Unsynced changes">
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-signal-amber flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[15px] font-semibold text-n-100">{pendingCount} change{pendingCount === 1 ? '' : 's'} {pendingCount === 1 ? 'has' : 'have'} not synced.</p>
            <p className="text-13 text-n-70 mt-0.5">Logging out may delay submission until you sign back in with a connection.</p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1 h-11">Stay signed in</button>
          <button onClick={onConfirm} className="btn-primary flex-1 h-11">Log out</button>
        </div>
      </div>
    </BottomSheet>
  );
}

function ShellContent({ base, role }: { base: string; role: string }) {
  const currentUser = useStore((s) => s.currentUser);
  const { logoutFromSupabase } = useAuth();
  const navigate = useNavigate();
  const overlay = useMobileOverlay();
  const [searchOpen, setSearchOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const syncPillRef = useRef<HTMLElement | null>(null);
  const { pendingCount, failedCount } = useSyncStatus();
  const { queued } = useIncidentQueue();
  // Field roles run the same background patrol-location beacon on mobile as
  // the desktop guard shell did — moving the shell here must not drop it.
  useLocationSharing();
  const { hasInventoryAccess } = useMyInventoryAccess();

  const totalPendingWork = pendingCount + failedCount + queued.length;

  const moreOpen = overlay?.isOpen('more') ?? false;
  const helpOpen = overlay?.isOpen('help') ?? false;
  const syncOpen = overlay?.isOpen('sync-details') ?? false;
  const closeMore = () => overlay?.close('more');

  const doLogout = async () => {
    setLogoutConfirmOpen(false);
    overlay?.close();
    await logoutFromSupabase();
    navigate('/login', { replace: true });
  };
  const handleLogout = () => {
    if (totalPendingWork > 0) { setLogoutConfirmOpen(true); return; }
    void doLogout();
  };

  const moreItems: MoreItem[] = [
    { label: 'My profile', icon: <UserCircle className="w-5 h-5" />, to: `${base}/profile` },
    // Task Groups: standing teams / campaign groups. Visible to everyone —
    // RLS already scopes what a given user actually sees inside it
    // (director: all, officer: their range, field role: only groups they
    // belong to), so there's no separate capability check needed here the
    // way Inventory needs hasInventoryAccess (Inventory is opt-in per
    // location; Task Groups membership is just "am I in one or not",
    // which the page itself already handles with an empty state).
    { label: 'Task Groups', icon: <UsersRound className="w-5 h-5" />, to: `${base}/groups` },
    // Inventory opens as a full module with its own internal navigation —
    // not a sixth bottom-nav destination, per the module spec. Director
    // always qualifies; anyone else needs at least one active Inventory
    // location assignment (never merely by holding the guard role) — both
    // cases are exactly what hasInventoryAccess already encodes.
    ...(hasInventoryAccess ? [{ label: 'Inventory', icon: <Boxes className="w-5 h-5" />, to: `${base}/inventory` }] : []),
    ...(role === 'director' ? [{ label: 'Personnel', icon: <Users className="w-5 h-5" />, to: `${base}/users` }] : []),
    ...(role === 'director' || role === 'range_officer'
      ? [{ label: 'System audit', icon: <History className="w-5 h-5" />, to: `${base}/audit` }]
      : []),
    { label: 'Help & support', icon: <HelpCircle className="w-5 h-5" />, onClick: () => overlay?.open('help', moreButtonRef.current) },
    { label: 'Log out', icon: <LogOut className="w-5 h-5" />, danger: true, onClick: handleLogout },
  ];

  // Active state is never colour-alone: a pale-green pill background plus
  // green icon/label. The focus ring lives on this same inner pill (sized to
  // the visible content) rather than the full-width/height NavLink, so
  // keyboard focus never reads as "a different tab is now selected".
  const navItem = (to: string, end: boolean, icon: React.ReactNode, label: string) => (
    <NavLink to={to} end={end} className="group flex-1 flex items-center justify-center min-h-[52px] focus-visible:outline-none">
      {({ isActive }) => (
        <span
          className={`flex flex-col items-center gap-0.5 px-3.5 py-1.5 rounded-lg transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ptr-accent group-focus-visible:ring-offset-1 ${
            isActive ? 'text-ptr-green bg-ptr-green/10' : 'text-n-70'
          }`}
        >
          {icon}
          <span className="text-[11px] font-medium">{label}</span>
        </span>
      )}
    </NavLink>
  );

  return (
    <div className="h-dvh bg-white flex flex-col overflow-hidden">
      {/* Top app bar — compact identity + status, no rail/sidebar */}
      <header
        className="sticky top-0 z-30 bg-ptr-green text-white flex items-center gap-2 px-3"
        style={{ height: 'calc(56px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
      >
        <img src={jharkhandEmblem} alt="" className="w-7 h-7 flex-shrink-0" />
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-[10px] text-white/70 uppercase tracking-wide leading-none truncate">Government of Jharkhand</div>
          <div className="text-[15px] font-semibold leading-tight truncate">Smart Forester</div>
        </div>
        <SyncPill onOpen={(trigger) => { syncPillRef.current = trigger; overlay?.open('sync-details', trigger); }} />
        <button
          onClick={() => setSearchOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors flex-shrink-0"
          aria-label="Search tasks, incidents, personnel and ranges"
        >
          <Search className="w-5 h-5" />
        </button>
        <NotificationBell />
      </header>

      {searchOpen && <MobileSearchOverlay base={base} onClose={() => setSearchOpen(false)} />}

      {/* The single scroll owner for every mobile page — pages rendered
          through this Outlet must stay in normal flow (no h-[calc(...)],
          no overflow-y-auto of their own) so there is never more than one
          vertical scrollbar on screen at once. */}
      <main
        className="flex-1 min-h-0 overflow-y-auto"
        style={{
          paddingBottom: 'calc(var(--ptr-bottom-nav-h) + env(safe-area-inset-bottom))',
          overscrollBehaviorY: 'contain',
        }}
      >
        <Outlet />
      </main>

      {/* Persistent bottom navigation — Home / Tasks / Incidents / Map / More.
          Reserves exactly its own rendered height on <main> above (via the
          --ptr-bottom-nav-h var) so short pages can never leave main's
          normal-flow box overlapping this fixed bar's hit-test region. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-n-30 flex items-stretch"
        style={{ height: 'var(--ptr-bottom-nav-h)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        {navItem(base, true, <Home className="w-5 h-5" />, 'Home')}
        {navItem(`${base}/tasks`, false, <ClipboardList className="w-5 h-5" />, 'Tasks')}
        {navItem(`${base}/incidents`, false, <AlertTriangle className="w-5 h-5" />, 'Incidents')}
        {navItem(`${base}/map`, false, <MapIcon className="w-5 h-5" />, 'Map')}
        <button
          ref={moreButtonRef}
          onClick={() => overlay?.open('more', moreButtonRef.current)}
          aria-label="More"
          aria-expanded={moreOpen}
          className="group flex-1 flex items-center justify-center min-h-[52px] focus-visible:outline-none"
        >
          <span className={`flex flex-col items-center gap-0.5 px-3.5 py-1.5 rounded-lg transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ptr-accent group-focus-visible:ring-offset-1 ${moreOpen ? 'text-ptr-green bg-ptr-green/10' : 'text-n-70'}`}>
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[11px] font-medium">More</span>
          </span>
        </button>
      </nav>

      <BottomSheet open={moreOpen} onClose={closeMore}>
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-13 font-semibold text-n-100 truncate">{currentUser?.name}</div>
            <div className="text-xs text-n-70 truncate">{currentUser?.designation}</div>
          </div>
          <button onClick={closeMore} className="w-9 h-9 flex items-center justify-center rounded text-n-70 hover:bg-n-20 transition-colors flex-shrink-0" aria-label="Close more menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="py-1 pb-3">
          {moreItems.map((item) => {
            const cls = `w-full flex items-center gap-3 px-4 min-h-[48px] text-[15px] transition-colors ${
              item.danger ? 'text-signal-red' : 'text-n-90 hover:bg-n-20'
            }`;
            const content = <><span className={item.danger ? 'text-signal-red' : 'text-n-70'}>{item.icon}</span>{item.label}</>;
            if (item.to) return <NavLink key={item.label} to={item.to} onClick={() => overlay?.close('more', { viaNavigation: true })} className={cls}>{content}</NavLink>;
            if (item.href) return <a key={item.label} href={item.href} className={cls}>{content}</a>;
            return <button key={item.label} onClick={item.onClick} className={cls}>{content}</button>;
          })}
        </div>
      </BottomSheet>

      <MobileHelpSheet open={helpOpen} onClose={() => overlay?.close('help')} />
      <SyncDetailsSheet open={syncOpen} onClose={() => overlay?.close('sync-details')} />
      <LogoutConfirmSheet
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => void doLogout()}
        pendingCount={totalPendingWork}
      />
    </div>
  );
}

export default function MobileShell({ base, role }: { base: string; role: string }) {
  return (
    <MobileOverlayProvider>
      <ShellContent base={base} role={role} />
    </MobileOverlayProvider>
  );
}
