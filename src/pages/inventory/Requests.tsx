import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import useStore from '../../store/useStore';
import { useInventoryRequests } from '../../hooks/useInventoryRequests';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useInventoryItems } from '../../hooks/useInventoryCatalog';
import { useSelectedInventoryLocation } from '../../hooks/useInventoryAccess';
import { canManageInventory } from '../../lib/permissions';
import { inventoryBase } from '../../lib/inventoryBase';
import { quantityInputStep, validateQuantity } from '../../lib/inventoryQuantity';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import ItemPicker from '../../components/inventory/ItemPicker';
import EvidenceCapture, { EMPTY_EVIDENCE, type CapturedEvidence } from '../../components/mobile/EvidenceCapture';
import { getErrorMessage } from '../../lib/errors';
import { formatDate } from '../../utils/formatters';
import type { InventoryRequestStatus, TaskPriority } from '../../types';

const STATUS_TONE: Record<InventoryRequestStatus, string> = {
  Draft: 'bg-n-20 text-n-80',
  Submitted: 'bg-signal-amber/10 text-signal-amber',
  Approved: 'bg-ptr-green/10 text-ptr-green',
  PartiallyApproved: 'bg-signal-amber/10 text-signal-amber',
  Rejected: 'bg-signal-red-bg text-signal-red',
  PartiallyFulfilled: 'bg-ptr-accent/10 text-ptr-accent',
  Fulfilled: 'bg-ptr-green/10 text-ptr-green',
  Cancelled: 'bg-n-20 text-n-70',
};

function NewRequestForm({ onClose }: { onClose: () => void }) {
  const { locations } = useInventoryLocations();
  const { items: allItems } = useInventoryItems();
  const items = allItems.filter((i) => i.active);
  // A real catalog item (seeded alongside the starter catalog), not a
  // client-only sentinel — inventory_request_items.item_id is a required
  // FK, so a free-text "Other" line still needs a real row to point at.
  // Picking it reveals a text field; what's typed there is carried through
  // as that line's `notes` (see create_inventory_request's redeploy
  // comment in schema.sql).
  const otherItem = items.find((it) => it.name === 'Other / not listed');
  // Pinned first (not left to sort alphabetically into the middle of the
  // list) so it's the thing you see without typing anything, not something
  // you have to already know to search for.
  const pickerItems = otherItem ? [otherItem, ...items.filter((it) => it.id !== otherItem.id)] : items;
  const { createRequest, submitRequest } = useInventoryRequests();
  // A guard covering more than one location defaults to whichever one
  // they're currently switched to on the Stock page (useSelectedInventoryLocation),
  // instead of an arbitrary first-in-list pick that could silently raise a
  // request against the wrong facility.
  const { selectedLocationId } = useSelectedInventoryLocation();
  const [locationId, setLocationId] = useState(selectedLocationId ?? locations[0]?.id ?? '');
  // selectedLocationId resolves one tick after mount (it reads localStorage
  // inside an effect) — pick it up once it arrives, but only while nothing
  // has been chosen yet, so it never overwrites a deliberate manual switch.
  useEffect(() => {
    if (selectedLocationId && !locationId) setLocationId(selectedLocationId);
  }, [selectedLocationId, locationId]);
  const [lines, setLines] = useState<{ itemId: string; qty: string; note: string }[]>([{ itemId: '', qty: '1', note: '' }]);
  const [requiredByDate, setRequiredByDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<CapturedEvidence>(EMPTY_EVIDENCE);

  const addLine = () => setLines((ls) => [...ls, { itemId: '', qty: '1', note: '' }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));
  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string; note: string }>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const lineError = (line: { itemId: string; qty: string }): string | null => {
    if (!line.itemId) return null;
    const allowsFractional = items.find((it) => it.id === line.itemId)?.allowsFractional;
    return validateQuantity(Number(line.qty), allowsFractional);
  };
  const isOtherLine = (line: { itemId: string }) => !!otherItem && line.itemId === otherItem.id;
  const validLines = lines.filter((l) => l.itemId && !lineError(l) && (!isOtherLine(l) || l.note.trim()));
  const hasInvalidLine = lines.some((l) => l.itemId && (lineError(l) || (isOtherLine(l) && !l.note.trim())));

  // Same item picked on more than one line is deliberately merged into a
  // single request line (summed quantity) rather than rejected or sent as
  // two rows, which would otherwise trip the DB's one-row-per-item
  // constraint on inventory_request_items. Two "Other" lines merge their
  // free-text notes too, instead of one silently overwriting the other.
  const mergedItems = Object.values(
    validLines.reduce<Record<string, { itemId: string; requestedQty: number; notes: string }>>((acc, l) => {
      const qty = Number(l.qty);
      const existing = acc[l.itemId];
      const note = l.note.trim();
      acc[l.itemId] = {
        itemId: l.itemId,
        requestedQty: (existing?.requestedQty ?? 0) + qty,
        notes: existing?.notes ? (note ? `${existing.notes}; ${note}` : existing.notes) : note,
      };
      return acc;
    }, {}),
  );

  const submit = async () => {
    if (!locationId || mergedItems.length === 0) return;
    try {
      const requestId = await createRequest.mutateAsync({
        requestingLocationId: locationId,
        items: mergedItems,
        requiredByDate: requiredByDate || undefined,
        priority,
        reason: reason.trim() || undefined,
        files: evidence.photos,
      });
      await submitRequest.mutateAsync(requestId);
      onClose();
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to submit the request.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Location</label>
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input-field select-field">
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      <div className="space-y-2">
        <label className="block text-13 font-medium text-n-90">Items</label>
        {lines.map((line, i) => {
          const allowsFractional = items.find((it) => it.id === line.itemId)?.allowsFractional;
          const error = lineError(line);
          const showOtherField = isOtherLine(line);
          return (
            <div key={i}>
              <div className="flex gap-2 items-center">
                <ItemPicker items={pickerItems} value={line.itemId} onChange={(id) => setLine(i, { itemId: id })} />
                <input
                  type="number" min="0" step={quantityInputStep(allowsFractional)} value={line.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                  className="input-field w-20 flex-shrink-0"
                />
                <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red disabled:opacity-40 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {showOtherField && (
                <input
                  value={line.note}
                  onChange={(e) => setLine(i, { note: e.target.value })}
                  className="input-field mt-1.5"
                  placeholder="What do you need? Be specific — e.g. Mosquito net, 2 units"
                />
              )}
              {error && <p className="text-xs text-signal-red mt-1">{error}</p>}
            </div>
          );
        })}
        <button onClick={addLine} className="btn-subtle"><Plus className="w-4 h-4" />Add item</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Required by</label>
          <input type="date" value={requiredByDate} onChange={(e) => setRequiredByDate(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Priority</label>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input-field select-field">
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </Select>
        </div>
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Reason</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Photos (optional)</label>
        <EvidenceCapture value={evidence} onChange={setEvidence} photosOnly showGps={false} showNote={false} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={createRequest.isPending || submitRequest.isPending || !locationId || mergedItems.length === 0 || hasInvalidLine}
          className="btn-primary"
        >
          Submit request
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export default function InventoryRequestsPage() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = canManageInventory(currentUser?.role);
  const { requests, isLoading } = useInventoryRequests();
  const [formOpen, setFormOpen] = useState(false);
  const base = inventoryBase(currentUser?.role);

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      {!isDirector && (
        <CommandBar>
          <button onClick={() => setFormOpen((o) => !o)} className="btn-primary"><Plus className="w-4 h-4" />New request</button>
        </CommandBar>
      )}

      <PageHeading title="Requests" meta={`${requests.length} request${requests.length === 1 ? '' : 's'}`} />

      {formOpen && <NewRequestForm onClose={() => setFormOpen(false)} />}

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : requests.length === 0 ? (
        <EmptyState title="No requests yet" description={isDirector ? undefined : 'Raise a request when you need more stock.'} />
      ) : (
        <div className="card divide-y divide-n-20">
          {requests.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate(`${base}/requests/${r.id}`)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-n-10 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-13 font-semibold text-n-100 truncate">
                  {r.requestingLocationName ?? '—'} {isDirector && r.requestedByName ? `· ${r.requestedByName}` : ''}
                </div>
                <div className="text-xs text-n-70 truncate">
                  {r.items.length} item{r.items.length === 1 ? '' : 's'}
                  {r.requiredByDate && ` · Needed by ${formatDate(r.requiredByDate)}`}
                </div>
              </div>
              <span className={`text-xs font-semibold px-2 h-6 rounded-full flex items-center flex-shrink-0 ${STATUS_TONE[r.status]}`}>
                {r.status}
              </span>
            </button>
          ))}
        </div>
      )}
      </Page>
    </>
  );
}
