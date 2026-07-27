import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileBarChart } from 'lucide-react';
import useStore from '../../store/useStore';
import { useInventoryStock } from '../../hooks/useInventoryStock';
import { useInventoryRequests } from '../../hooks/useInventoryRequests';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useInventoryPurchases } from '../../hooks/useInventoryPurchases';
import { useInventoryBatches } from '../../hooks/useInventoryBatches';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { canManageInventory } from '../../lib/permissions';
import { inventoryBase } from '../../lib/inventoryBase';
import { daysUntilExpiry } from '../../utils/expiry';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Metric({ label, value, tone = 'default', onClick }: {
  label: string; value: number; tone?: 'default' | 'red' | 'amber'; onClick: () => void;
}) {
  const cls = tone === 'red' ? 'text-signal-red' : tone === 'amber' ? 'text-signal-amber' : 'text-n-100';
  return (
    <button onClick={onClick} className="text-left bg-white border border-n-30 rounded-lg p-2.5 active:bg-n-10 transition-colors">
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-13 text-n-80 mt-0.5">{label}</div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-4 mb-1.5 text-13 font-semibold text-n-90">{children}</div>;
}

export default function InventoryHome() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = canManageInventory(currentUser?.role);
  const base = inventoryBase(currentUser?.role);
  const { stock } = useInventoryStock();
  const { requests } = useInventoryRequests();
  const { locations } = useInventoryLocations();
  const { purchases } = useInventoryPurchases();
  const { batches } = useInventoryBatches();
  const { state: syncState } = useSyncStatus();

  const lowStock = stock.filter((s) => s.minStock !== undefined && s.availableQty <= s.minStock);
  const pendingApproval = requests.filter((r) => r.status === 'Submitted');
  const myOpenRequests = requests.filter((r) => ['Draft', 'Submitted', 'Approved', 'PartiallyApproved'].includes(r.status));
  const expiringSoon = batches.filter((b) => b.remainingQty > 0 && b.expiryDate && daysUntilExpiry(b.expiryDate) <= 30);

  return (
    <div className="pb-4">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-xl font-semibold text-n-100">{greeting()}, {currentUser?.name?.split(' ')[0]}</h1>
        <p className="text-13 text-n-70 mt-0.5">
          {isDirector ? `${locations.length} location${locations.length === 1 ? '' : 's'}` : 'Inventory'} · {syncState === 'offline' ? 'Offline — showing last synced data' : syncState === 'syncing' ? 'Syncing…' : 'Up to date'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-4 mb-5">
        <Metric label="Low stock items" value={lowStock.length} tone={lowStock.length > 0 ? 'red' : 'default'} onClick={() => navigate(`${base}/stock`)} />
        {isDirector ? (
          <Metric label="Awaiting approval" value={pendingApproval.length} tone={pendingApproval.length > 0 ? 'amber' : 'default'} onClick={() => navigate(`${base}/requests`)} />
        ) : (
          <Metric label="My open requests" value={myOpenRequests.length} tone={myOpenRequests.length > 0 ? 'amber' : 'default'} onClick={() => navigate(`${base}/requests`)} />
        )}
        <Metric label="Purchases" value={purchases.length} onClick={() => navigate(`${base}/purchases`)} />
        <Metric label="Expiring within 30d" value={expiringSoon.length} tone={expiringSoon.length > 0 ? 'amber' : 'default'} onClick={() => navigate(`${base}/reports`)} />
      </div>

      <div className="px-4 mb-5 space-y-2">
        <button onClick={() => navigate(`${base}/reports`)} className="w-full flex items-center justify-between gap-3 bg-white border border-n-30 rounded-lg px-4 py-3 active:bg-n-10">
          <span className="flex items-center gap-2 text-[15px] font-medium text-n-100"><FileBarChart className="w-4 h-4 text-n-70" />Inventory reports</span>
          <ChevronRight className="w-4 h-4 text-n-50" />
        </button>
        <button onClick={() => navigate(`${base}/transactions`)} className="w-full flex items-center justify-between gap-3 bg-white border border-n-30 rounded-lg px-4 py-3 active:bg-n-10">
          <span className="text-[15px] font-medium text-n-100">Transactions</span>
          <ChevronRight className="w-4 h-4 text-n-50" />
        </button>
      </div>

      {/* Catalog & staffing — director-only management pages, otherwise
          unreachable from mobile (no other in-app link to them at all). */}
      {isDirector && (
        <div className="mb-5">
          <SectionLabel>Catalog & staffing</SectionLabel>
          <div className="bg-white divide-y divide-n-20">
            {[
              { label: 'Items', to: `${base}/items` },
              { label: 'Categories & units', to: `${base}/categories` },
              { label: 'Locations', to: `${base}/locations` },
              { label: 'Managers', to: `${base}/managers` },
            ].map((l) => (
              <button key={l.to} onClick={() => navigate(l.to)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-n-10">
                <span className="text-[15px] font-medium text-n-100">{l.label}</span>
                <ChevronRight className="w-4 h-4 text-n-50 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {isDirector && pendingApproval.length > 0 && (
        <div className="mb-5">
          <SectionLabel>Needs attention</SectionLabel>
          <div className="bg-white divide-y divide-n-20">
            {pendingApproval.slice(0, 5).map((r) => (
              <button key={r.id} onClick={() => navigate(`${base}/requests/${r.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-n-10">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-n-100 truncate">{r.requestingLocationName ?? '—'}</div>
                  <div className="text-13 text-n-70">{r.items.length} item{r.items.length === 1 ? '' : 's'} · {r.requestedByName ?? '—'}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-n-50 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {!isDirector && (
        <div className="px-4">
          <button onClick={() => navigate(`${base}/requests`)} className="btn-primary w-full">Raise a request</button>
        </div>
      )}
    </div>
  );
}
