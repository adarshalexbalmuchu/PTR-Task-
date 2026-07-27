import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Tags, MapPin, Boxes, ClipboardList, ShoppingCart, History, FileBarChart, UsersRound } from 'lucide-react';
import useStore from '../../store/useStore';
import { canManageInventory } from '../../lib/permissions';
import { inventoryBase } from '../../lib/inventoryBase';
import { useIsMobile } from '../../hooks/useIsMobile';
import FilterChips from '../mobile/FilterChips';

interface NavEntry { key: string; label: string; icon: React.ReactNode }

// The Inventory module's own cross-page navigation — without this, Items/
// Categories/Locations/Managers (director-only catalog & staffing pages)
// and Stock/Requests/Purchases/Transactions/Reports have no in-app links
// to each other at all; every page here was reachable only by typing the
// URL directly. Rendered via <ContextPanel> (see Slots.tsx): portals into
// the desktop shell's contextual side panel as a vertical list there, but
// none of these pages have any mobile-specific layout of their own (they're
// all desktop-style pages that just get squeezed into a narrow viewport),
// so on mobile this renders as the same horizontal FilterChips row already
// used for filters elsewhere (MobileTaskList etc.) instead of dumping a
// tall stacked list above the actual page content.
export default function InventorySubNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = canManageInventory(currentUser?.role);
  const base = inventoryBase(currentUser?.role);

  const entries: NavEntry[] = [
    { key: '', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    ...(isDirector ? [
      { key: 'items', label: 'Items', icon: <Package className="w-4 h-4" /> },
      { key: 'categories', label: 'Categories & units', icon: <Tags className="w-4 h-4" /> },
      { key: 'locations', label: 'Locations', icon: <MapPin className="w-4 h-4" /> },
    ] : []),
    { key: 'stock', label: 'Stock', icon: <Boxes className="w-4 h-4" /> },
    { key: 'requests', label: 'Requests', icon: <ClipboardList className="w-4 h-4" /> },
    { key: 'purchases', label: 'Purchases', icon: <ShoppingCart className="w-4 h-4" /> },
    { key: 'transactions', label: 'Transactions', icon: <History className="w-4 h-4" /> },
    { key: 'reports', label: 'Reports', icon: <FileBarChart className="w-4 h-4" /> },
    ...(isDirector ? [{ key: 'managers', label: 'Managers', icon: <UsersRound className="w-4 h-4" /> }] : []),
  ];

  // Matches on the first path segment after `base` — RequestDetail
  // (base/requests/:id) correctly highlights "Requests" this way too.
  const activeKey = location.pathname.slice(base.length).replace(/^\//, '').split('/')[0] ?? '';
  const go = (key: string) => navigate(key ? `${base}/${key}` : base);

  if (isMobile) {
    return (
      <FilterChips
        chips={entries.map((e) => ({ id: e.key, label: e.label }))}
        active={activeKey}
        onChange={go}
      />
    );
  }

  return (
    <nav className="space-y-0.5">
      {entries.map((entry) => (
        <button
          key={entry.key}
          onClick={() => go(entry.key)}
          className={`w-full flex items-center gap-3 px-2.5 h-10 rounded text-13 transition-colors ${
            activeKey === entry.key ? 'bg-ptr-green/10 text-ptr-green font-semibold' : 'text-n-90 hover:bg-n-20'
          }`}
        >
          {entry.icon}
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
