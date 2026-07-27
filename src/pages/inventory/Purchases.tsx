import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useInventoryPurchases } from '../../hooks/useInventoryPurchases';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useInventoryItems } from '../../hooks/useInventoryCatalog';
import { useSelectedInventoryLocation } from '../../hooks/useInventoryAccess';
import { quantityInputStep, validateQuantity } from '../../lib/inventoryQuantity';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage } from '../../lib/errors';
import { formatDate } from '../../utils/formatters';

type Line = { itemId: string; qty: string; unitCost: string; batchNumber: string; expiryDate: string };
const EMPTY_LINE: Line = { itemId: '', qty: '1', unitCost: '', batchNumber: '', expiryDate: '' };

function NewPurchaseForm({ onClose }: { onClose: () => void }) {
  const { locations: allLocations } = useInventoryLocations();
  const locations = allLocations.filter((l) => l.active);
  const { items: allItems } = useInventoryItems();
  const items = allItems.filter((i) => i.active);
  const { createPurchase } = useInventoryPurchases();
  const { selectedLocationId } = useSelectedInventoryLocation();

  const [locationId, setLocationId] = useState(selectedLocationId ?? locations[0]?.id ?? '');
  useEffect(() => {
    if (selectedLocationId && !locationId) setLocationId(selectedLocationId);
  }, [selectedLocationId, locationId]);
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState('');
  // One idempotency key per outstanding submission attempt, reused across a
  // retry so the server can recognize and skip a duplicate — same pattern
  // as the Opening Balance form.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const addLine = () => setLines((ls) => [...ls, { ...EMPTY_LINE }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const lineError = (line: Line): string | null => {
    if (!line.itemId) return null;
    const allowsFractional = items.find((it) => it.id === line.itemId)?.allowsFractional;
    return validateQuantity(Number(line.qty), allowsFractional);
  };
  const validLines = lines.filter((l) => l.itemId && !lineError(l));
  const hasInvalidLine = lines.some((l) => l.itemId && lineError(l));

  const submit = async () => {
    if (!locationId || !purchaseDate || validLines.length === 0) return;
    setError('');
    try {
      await createPurchase.mutateAsync({
        locationId,
        supplierName: supplierName.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        purchaseDate,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.qty),
          unitCost: l.unitCost ? Number(l.unitCost) : undefined,
          batchNumber: l.batchNumber.trim() || undefined,
          expiryDate: l.expiryDate || undefined,
        })),
        idempotencyKey: idempotencyKeyRef.current,
      });
      idempotencyKeyRef.current = crypto.randomUUID();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to record the purchase.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {error && <p className="text-13 text-signal-red">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Receiving location</label>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field">
            <option value="">Select location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Purchase date</label>
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Supplier (optional)</label>
          <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="input-field" placeholder="Supplier or vendor name" />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Invoice number (optional)</label>
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="input-field" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-13 font-medium text-n-90">Items</label>
        {lines.map((line, i) => {
          const item = items.find((it) => it.id === line.itemId);
          const showBatchFields = !!item && (item.trackBatch || item.trackExpiry);
          const err = lineError(line);
          return (
            <div key={i} className="border border-n-30 rounded-lg p-2.5 space-y-2">
              <div className="flex gap-2 items-center">
                <Select value={line.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })} className="input-field select-field flex-1">
                  <option value="">Select item</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </Select>
                <input
                  type="number" min="0" step={quantityInputStep(item?.allowsFractional)} value={line.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                  className="input-field w-20 flex-shrink-0" placeholder="Qty"
                />
                <input
                  type="number" min="0" step="0.01" value={line.unitCost}
                  onChange={(e) => setLine(i, { unitCost: e.target.value })}
                  className="input-field w-24 flex-shrink-0" placeholder="Unit cost"
                />
                <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red disabled:opacity-40 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {err && <p className="text-xs text-signal-red">{err}</p>}
              {showBatchFields && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={line.batchNumber} onChange={(e) => setLine(i, { batchNumber: e.target.value })}
                    className="input-field" placeholder="Batch number (optional)"
                  />
                  <input
                    type="date" value={line.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })}
                    className="input-field" placeholder="Expiry date"
                  />
                </div>
              )}
            </div>
          );
        })}
        <button onClick={addLine} className="btn-subtle"><Plus className="w-4 h-4" />Add item</button>
      </div>

      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={createPurchase.isPending || !locationId || !purchaseDate || validLines.length === 0 || hasInvalidLine}
          className="btn-primary"
        >
          Record purchase
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export default function InventoryPurchasesPage() {
  const { purchases, isLoading } = useInventoryPurchases();
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      <CommandBar>
        <button onClick={() => setFormOpen((o) => !o)} className="btn-primary"><Plus className="w-4 h-4" />Record purchase</button>
      </CommandBar>

      <PageHeading title="Purchases" meta={`${purchases.length} purchase${purchases.length === 1 ? '' : 's'}`} />

      {formOpen && <NewPurchaseForm onClose={() => setFormOpen(false)} />}

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : purchases.length === 0 ? (
        <EmptyState title="No purchases recorded yet" description="Record a delivery to add stock and, for batch/expiry-tracked items, start an expiry forecast." />
      ) : (
        <div className="card divide-y divide-n-20">
          {purchases.map((p) => {
            const expanded = expandedId === p.id;
            const totalCost = p.items.reduce((sum, it) => sum + (it.unitCost ?? 0) * it.quantity, 0);
            return (
              <div key={p.id}>
                <button
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-n-10 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-13 font-semibold text-n-100 truncate">
                      {p.locationName ?? '—'} {p.supplierName ? `· ${p.supplierName}` : ''}
                    </div>
                    <div className="text-xs text-n-70 truncate">
                      {formatDate(p.purchaseDate)} · {p.items.length} item{p.items.length === 1 ? '' : 's'}
                      {totalCost > 0 ? ` · ₹${totalCost.toFixed(2)}` : ''}
                      {p.invoiceNumber ? ` · Inv #${p.invoiceNumber}` : ''}
                    </div>
                  </div>
                  {expanded ? <ChevronUp className="w-4 h-4 text-n-50 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-n-50 flex-shrink-0" />}
                </button>
                {expanded && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {p.items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between text-13 text-n-90 bg-n-10 rounded px-3 py-2">
                        <span className="truncate">
                          {it.itemName ?? '—'} — {it.quantity}{it.unitAbbreviation ? ` ${it.unitAbbreviation}` : ''}
                          {it.batchNumber ? ` · Batch ${it.batchNumber}` : ''}
                          {it.expiryDate ? ` · Exp ${formatDate(it.expiryDate)}` : ''}
                        </span>
                        {it.unitCost != null && <span className="flex-shrink-0 text-n-70">₹{it.unitCost.toFixed(2)}/unit</span>}
                      </div>
                    ))}
                    {p.notes && <p className="text-13 text-n-70 italic">{p.notes}</p>}
                    <p className="text-xs text-n-70">Recorded by {p.createdByName ?? '—'}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </Page>
    </>
  );
}
