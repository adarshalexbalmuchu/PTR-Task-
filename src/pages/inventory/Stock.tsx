import { useRef, useState } from 'react';
import { MapPin, Plus, Search } from 'lucide-react';
import useStore from '../../store/useStore';
import { useInventoryStock } from '../../hooks/useInventoryStock';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useInventoryItems } from '../../hooks/useInventoryCatalog';
import { useSelectedInventoryLocation } from '../../hooks/useInventoryAccess';
import { canManageInventory } from '../../lib/permissions';
import { quantityInputStep, validateQuantity } from '../../lib/inventoryQuantity';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage } from '../../lib/errors';

function OpeningBalanceForm({ onClose }: { onClose: () => void }) {
  const { postOpeningBalance } = useInventoryStock();
  const { locations: allLocations } = useInventoryLocations();
  const locations = allLocations.filter((l) => l.active);
  const { items: allItems } = useInventoryItems();
  const items = allItems.filter((i) => i.active);

  const [locationId, setLocationId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  // One idempotency key per outstanding submission attempt, reused across a
  // retry (e.g. re-clicking Post after a network timeout) so the server can
  // recognize and skip a duplicate — regenerated only once this submission
  // actually succeeds or the selected item/location/quantity changes.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const selectedItem = items.find((i) => i.id === itemId);
  const quantityError = itemId ? validateQuantity(Number(quantity), selectedItem?.allowsFractional) : null;
  const canSubmit = !!locationId && !!itemId && !quantityError;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await postOpeningBalance.mutateAsync({
        itemId, locationId, quantity: Number(quantity),
        notes: notes.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });
      idempotencyKeyRef.current = crypto.randomUUID();
      onClose();
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to post the opening balance.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {(locations.length === 0 || items.length === 0) && (
        <p className="text-13 text-signal-amber">Add at least one active location and item first.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Location</label>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field">
            <option value="">Select location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Item</label>
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} className="input-field select-field">
            <option value="">Select item</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Opening quantity</label>
          <input
            type="number" min="0" step={quantityInputStep(selectedItem?.allowsFractional)}
            value={quantity} onChange={(e) => setQuantity(e.target.value)}
            className="input-field"
          />
          {quantityError && <p className="text-xs text-signal-red mt-1">{quantityError}</p>}
        </div>
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Note (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={postOpeningBalance.isPending || !canSubmit} className="btn-primary">
          Post opening balance
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export default function InventoryStockPage() {
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = canManageInventory(currentUser?.role);
  const { stock, isLoading } = useInventoryStock();
  const { locations } = useInventoryLocations();
  const {
    assignedLocations, selectedLocationId, selectedLocation, selectLocation, needsSelection,
  } = useSelectedInventoryLocation();
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // A director browses across every location (the "All my locations"
  // filter below is genuinely optional there). A guard covering more than
  // one location must never see their stock silently merged — the
  // persisted, explicitly-picked location is the only thing that filters
  // the list for them, not a client-side dropdown that defaults to "all".
  const effectiveLocationId = isDirector ? locationId : (selectedLocationId ?? '');

  const filtered = stock.filter((s) => {
    if (effectiveLocationId && s.locationId !== effectiveLocationId) return false;
    if (search && !(s.itemName ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      {isDirector && (
        <CommandBar>
          <button onClick={() => setFormOpen((o) => !o)} className="btn-primary"><Plus className="w-4 h-4" />Post opening balance</button>
        </CommandBar>
      )}

      <PageHeading title="Stock" meta={`${filtered.length} balance${filtered.length === 1 ? '' : 's'}`} />

      {isDirector && formOpen && <OpeningBalanceForm onClose={() => setFormOpen(false)} />}

      {!isDirector && assignedLocations.length > 0 && (
        <div className="flex items-center gap-2 text-13 text-n-80">
          <MapPin className="w-4 h-4 text-ptr-green flex-shrink-0" />
          {assignedLocations.length > 1 ? (
            <Select
              value={selectedLocationId ?? ''}
              onChange={(e) => selectLocation(e.target.value)}
              className="input-field select-field max-w-xs"
            >
              <option value="" disabled>Select a location</option>
              {assignedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          ) : (
            <span className="font-semibold text-n-100">{selectedLocation?.name ?? '—'}</span>
          )}
        </div>
      )}

      {needsSelection ? (
        <EmptyState title="Select a location" description="Choose which of your assigned locations you want to view." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="w-4 h-4 text-n-70 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" className="input-field pl-8" />
            </div>
            {isDirector && locations.length > 1 && (
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field max-w-xs">
                <option value="">All my locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>

          {isLoading ? (
            <div className="skeleton h-40" />
          ) : filtered.length === 0 ? (
            <EmptyState title="No stock recorded yet" description="Ask a director to post an opening balance for your location." />
          ) : (
            <div className="card divide-y divide-n-20">
              {filtered.map((s) => {
                const low = s.minStock !== undefined && s.availableQty <= s.minStock;
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-13 font-semibold text-n-100 truncate">{s.itemName ?? 'Unknown item'}</div>
                      <div className="text-xs text-n-70 truncate">{s.locationName ?? '—'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-13 font-semibold tabular-nums ${low ? 'text-signal-red' : 'text-n-100'}`}>
                        {s.availableQty} {s.unitAbbreviation ?? ''}
                      </div>
                      {low && <div className="text-xs text-signal-red">Low stock</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      </Page>
    </>
  );
}
