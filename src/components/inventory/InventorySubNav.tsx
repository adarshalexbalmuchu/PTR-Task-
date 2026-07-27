import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Tags, MapPin, Boxes, ClipboardList, ShoppingCart, History, FileBarChart, UsersRound } from 'lucide-react';
import useStore from '../../store/useStore';
import { canManageInventory } from '../../lib/permissions';
import { inventoryBase } from '../../lib/inventoryBase';

interface NavEntry { key: string; label: string; icon: React.ReactNode }

// The Inventory module's own cross-page navigation — without this, Items/
// Categories/Locations/Managers (director-only catalog & staffing pages)
// and Stock/Requests/Purchases/Transactions/Reports have no in-app links
// to each other at all; every page here was reachable only by typing the
// URL directly. Rendered via <ContextPanel> (see Slots.tsx) so it portals
// into the desktop shell's contextual side panel and falls back to an
// inline list on mobile — same mechanism officer/Dashboard.tsx already
// uses for its own same-page "Views" nav.
export default function InventorySubNav() {
  const navigate = useNavigate();
  const location = useLocation();
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

  return (
    <nav>
      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-n-70">Inventory</div>
      {entries.map((entry) => (
        <button
          key={entry.key}
          onClick={() => navigate(entry.key ? `${base}/${entry.key}` : base)}
          className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded text-13 transition-colors ${
            activeKey === entry.key ? 'bg-ptr-green/10 text-ptr-green font-medium' : 'text-n-90 hover:bg-n-20'
          }`}
        >
          {entry.icon}
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
