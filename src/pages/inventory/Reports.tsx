import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { useInventoryPurchases } from '../../hooks/useInventoryPurchases';
import { useInventorySales } from '../../hooks/useInventorySales';
import { useInventorySalesMonthly } from '../../hooks/useInventorySalesMonthly';
import { useInventoryBatches } from '../../hooks/useInventoryBatches';
import { useInventoryIssuedMonthly } from '../../hooks/useInventoryIssuedMonthly';
import { useInventoryItems } from '../../hooks/useInventoryCatalog';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import Tabs from '../../components/ui/Tabs';
import { Page, PageHeading } from '../../components/layout/Page';
import { ContextPanel } from '../../components/layout/Slots';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { formatDate } from '../../utils/formatters';
import { daysUntilExpiry, expiryUrgency, type ExpiryUrgency } from '../../utils/expiry';

const URGENCY_TONE: Record<ExpiryUrgency, string> = {
  expired: 'bg-signal-red-bg text-signal-red',
  critical: 'bg-signal-red-bg text-signal-red',
  warning: 'bg-signal-amber/10 text-signal-amber',
  ok: 'bg-n-20 text-n-80',
};
const URGENCY_LABEL: Record<ExpiryUrgency, (days: number) => string> = {
  expired: (d) => `Expired ${Math.abs(d)}d ago`,
  critical: (d) => `${d}d left`,
  warning: (d) => `${d}d left`,
  ok: (d) => `${d}d left`,
};

function PurchaseHistoryTab() {
  const { purchases, isLoading } = useInventoryPurchases();
  const { locations } = useInventoryLocations();
  const [locationId, setLocationId] = useState('');

  const filtered = locationId ? purchases.filter((p) => p.locationId === locationId) : purchases;
  const totalCost = filtered.reduce((sum, p) => sum + p.items.reduce((s, it) => s + (it.unitCost ?? 0) * it.quantity, 0), 0);

  if (isLoading) return <div className="skeleton h-40" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field max-w-xs">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        {totalCost > 0 && <span className="text-13 text-n-70">Total: ₹{totalCost.toFixed(2)}</span>}
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No purchases recorded yet" description="Record a delivery from the Purchases page to see it here." />
      ) : (
        <div className="card divide-y divide-n-20">
          {filtered.map((p) => {
            const cost = p.items.reduce((s, it) => s + (it.unitCost ?? 0) * it.quantity, 0);
            return (
              <div key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-13 font-semibold text-n-100">{p.locationName ?? '—'} {p.supplierName ? `· ${p.supplierName}` : ''}</div>
                  <div className="text-13 text-n-70">{formatDate(p.purchaseDate)}</div>
                </div>
                <div className="text-xs text-n-70 mt-0.5">
                  {p.items.map((it) => it.itemName).filter(Boolean).join(', ') || `${p.items.length} item(s)`}
                  {cost > 0 ? ` · ₹${cost.toFixed(2)}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SalesTab() {
  const { sales, isLoading: salesLoading } = useInventorySales();
  const { rows, isLoading: monthlyLoading } = useInventorySalesMonthly();
  const { locations } = useInventoryLocations();
  const [locationId, setLocationId] = useState('');

  const filteredSales = locationId ? sales.filter((s) => s.locationId === locationId) : sales;
  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.items.reduce((s2, it) => s2 + (it.unitPrice ?? 0) * it.quantity, 0), 0);

  const chartData = useMemo(() => {
    const filtered = rows.filter((r) => !locationId || r.locationId === locationId);
    const byMonth = new Map<string, number>();
    for (const r of filtered) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.revenue);
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month: formatDate(month).replace(/\d{1,2} /, ''), Revenue: Math.round(revenue * 100) / 100 }));
  }, [rows, locationId]);

  if (salesLoading || monthlyLoading) return <div className="skeleton h-40" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field max-w-xs">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        {totalRevenue > 0 && <span className="text-13 text-n-70">Total: ₹{totalRevenue.toFixed(2)}</span>}
      </div>

      <div className="card p-4">
        {chartData.length === 0 ? (
          <EmptyState title="No sales history yet" description="Record a sale from the Sales page to see revenue trends here." />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#EDEBE9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#605E5C' }} axisLine={{ stroke: '#E1DFDD' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#605E5C' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #EDEBE9', boxShadow: '0 4px 16px -4px rgba(32,31,30,0.18)' }} cursor={{ fill: '#FAF9F8' }} formatter={(value) => [`₹${Number(value).toFixed(2)}`, 'Revenue']} />
              <Bar dataKey="Revenue" fill="#1A7F4B" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {filteredSales.length === 0 ? (
        <EmptyState title="No sales recorded yet" description="Record a sale from the Sales page to see it here." />
      ) : (
        <div className="card divide-y divide-n-20">
          {filteredSales.map((s) => {
            const revenue = s.items.reduce((sum, it) => sum + (it.unitPrice ?? 0) * it.quantity, 0);
            return (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-13 font-semibold text-n-100">{s.locationName ?? '—'} {s.buyerName ? `· ${s.buyerName}` : ''}</div>
                  <div className="text-13 text-n-70">{formatDate(s.saleDate)}</div>
                </div>
                <div className="text-xs text-n-70 mt-0.5">
                  {s.items.map((it) => it.itemName).filter(Boolean).join(', ') || `${s.items.length} item(s)`}
                  {revenue > 0 ? ` · ₹${revenue.toFixed(2)}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IssuanceTrendsTab() {
  const { rows, isLoading } = useInventoryIssuedMonthly();
  const { items } = useInventoryItems();
  const { locations } = useInventoryLocations();
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');

  const chartData = useMemo(() => {
    const filtered = rows.filter((r) => (!itemId || r.itemId === itemId) && (!locationId || r.locationId === locationId));
    const byMonth = new Map<string, number>();
    for (const r of filtered) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.issuedQty);
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, qty]) => ({ month: formatDate(month).replace(/\d{1,2} /, ''), Issued: qty }));
  }, [rows, itemId, locationId]);

  if (isLoading) return <div className="skeleton h-40" />;
  return (
    <div className="space-y-3">
      <p className="text-13 text-n-70">
        Stock issued from central inventory to a location, by month — not final point-of-use consumption at that location.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={itemId} onChange={(e) => setItemId(e.target.value)} className="input-field select-field max-w-xs">
          <option value="">All items</option>
          {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
        </Select>
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field max-w-xs">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <div className="card p-4">
        {chartData.length === 0 ? (
          <EmptyState title="No issuance history yet" description="This fills in once stock has been issued against approved requests." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#EDEBE9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#605E5C' }} axisLine={{ stroke: '#E1DFDD' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#605E5C' }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #EDEBE9', boxShadow: '0 4px 16px -4px rgba(32,31,30,0.18)' }} cursor={{ fill: '#FAF9F8' }} />
              <Bar dataKey="Issued" fill="#1A7F4B" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ExpiryForecastTab() {
  const { batches, isLoading } = useInventoryBatches();
  const expiring = batches
    .filter((b) => b.remainingQty > 0 && b.expiryDate)
    .map((b) => ({ ...b, daysLeft: daysUntilExpiry(b.expiryDate!) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (isLoading) return <div className="skeleton h-40" />;
  if (expiring.length === 0) {
    return <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Nothing tracked for expiry" description="Batches from purchases of expiry-tracked items will show up here as they approach their expiry date." />;
  }
  return (
    <div className="card divide-y divide-n-20">
      {expiring.map((b) => {
        const urgency = expiryUrgency(b.daysLeft);
        return (
          <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-13 font-semibold text-n-100 truncate">{b.itemName ?? '—'} {b.batchNumber ? `· Batch ${b.batchNumber}` : ''}</div>
              <div className="text-xs text-n-70">{b.locationName ?? '—'} · {b.remainingQty} remaining · Expires {formatDate(b.expiryDate!)}</div>
            </div>
            <span className={`text-xs font-semibold px-2 h-6 rounded-full flex items-center flex-shrink-0 ${URGENCY_TONE[urgency]}`}>
              {URGENCY_LABEL[urgency](b.daysLeft)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function InventoryReports() {
  const [tab, setTab] = useState('purchases');
  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      <PageHeading title="Inventory reports" />
      <Tabs
        tabs={[
          { id: 'purchases', label: 'Purchase history' },
          { id: 'sales', label: 'Sales' },
          { id: 'trends', label: 'Issuance trends' },
          { id: 'expiry', label: 'Expiry forecast' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'purchases' && <PurchaseHistoryTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'trends' && <IssuanceTrendsTab />}
      {tab === 'expiry' && <ExpiryForecastTab />}
      </Page>
    </>
  );
}
