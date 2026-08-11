import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useRanges } from '../../hooks/useRanges';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage, friendlyDeleteErrorMessage } from '../../lib/errors';
import type { InventoryLocation, InventoryLocationType } from '../../types';

const LOCATION_TYPE_LABELS: Record<InventoryLocationType, string> = {
  central_warehouse: 'Central warehouse',
  range_store: 'Range store',
  forest_office: 'Forest office',
  resort: 'Resort',
  hotel: 'Hotel',
  guest_house: 'Guest house',
  kitchen: 'Kitchen',
  housekeeping_store: 'Housekeeping store',
  other_facility: 'Other facility',
};

interface FormState {
  name: string;
  type: InventoryLocationType;
  rangeId: string;
  addressDescription: string;
  parentLocationId: string;
}

const EMPTY_FORM: FormState = { name: '', type: 'range_store', rangeId: '', addressDescription: '', parentLocationId: '' };

function locationToForm(loc: InventoryLocation): FormState {
  return {
    name: loc.name,
    type: loc.type,
    rangeId: loc.rangeId ?? '',
    addressDescription: loc.addressDescription,
    parentLocationId: loc.parentLocationId ?? '',
  };
}

// Shared by both "New location" and the per-row edit form — same fields,
// different submit target.
function LocationFormFields({
  form, onChange, locations, excludeLocationId, ranges,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  locations: InventoryLocation[];
  excludeLocationId?: string;
  ranges: { id: string; name: string }[];
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Name</label>
          <input value={form.name} onChange={(e) => onChange({ name: e.target.value })} className="input-field" placeholder="Betla Resort" />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Type</label>
          <Select value={form.type} onChange={(e) => onChange({ type: e.target.value as InventoryLocationType })} className="input-field select-field">
            {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
          <Select value={form.rangeId} onChange={(e) => onChange({ rangeId: e.target.value })} className="input-field select-field">
            <option value="">None</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Parent location</label>
          <Select value={form.parentLocationId} onChange={(e) => onChange({ parentLocationId: e.target.value })} className="input-field select-field">
            <option value="">None</option>
            {locations.filter((l) => l.id !== excludeLocationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Address / description</label>
        <input value={form.addressDescription} onChange={(e) => onChange({ addressDescription: e.target.value })} className="input-field" />
      </div>
    </>
  );
}

export default function InventoryLocations() {
  const { locations, isLoading, createLocation, updateLocation, deleteLocation } = useInventoryLocations();
  const { ranges } = useRanges();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
    setFormOpen((o) => !o);
  };

  const startEdit = (loc: InventoryLocation) => {
    setFormOpen(false);
    setError('');
    setEditingId(loc.id);
    setEditForm(locationToForm(loc));
  };

  const submitCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await createLocation.mutateAsync({
        name: form.name.trim(), type: form.type, rangeId: form.rangeId || undefined,
        addressDescription: form.addressDescription.trim() || undefined,
        parentLocationId: form.parentLocationId || undefined,
      });
      setForm(EMPTY_FORM);
      setFormOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create location.'));
    }
  };

  const submitEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    try {
      await updateLocation.mutateAsync({
        id: editingId, name: editForm.name.trim(), type: editForm.type,
        // Explicit null (not undefined) when cleared to "None" — undefined
        // means "don't touch this field", which would leave a stale range/
        // parent in place instead of actually clearing it.
        rangeId: editForm.rangeId || null,
        addressDescription: editForm.addressDescription.trim(),
        parentLocationId: editForm.parentLocationId || null,
      });
      setEditingId(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save changes.'));
    }
  };

  const toggleActive = async (loc: InventoryLocation) => {
    try {
      await updateLocation.mutateAsync({ id: loc.id, active: !loc.active });
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to update the location.'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLocation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      alert(friendlyDeleteErrorMessage(err, 'location'));
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-6">
      <CommandBar>
        <button onClick={startCreate} className="btn-primary">
          <Plus className="w-4 h-4" />New location
        </button>
      </CommandBar>

      <PageHeading title="Inventory locations" meta={`${locations.length} location${locations.length === 1 ? '' : 's'}`} />

      {error && <p className="text-13 text-signal-red">{error}</p>}

      {formOpen && (
        <div className="card p-4 space-y-3 max-w-xl">
          <LocationFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} locations={locations} ranges={ranges} />
          <div className="flex gap-2">
            <button onClick={() => void submitCreate()} disabled={createLocation.isPending || !form.name.trim()} className="btn-primary">Create</button>
            <button onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : locations.length === 0 ? (
        <EmptyState title="No locations yet" description="Add a warehouse, resort, or store to start tracking stock." />
      ) : (
        <div className="card divide-y divide-n-20">
          {locations.map((loc) => (
            <div key={loc.id}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-13 font-semibold text-n-100 truncate">{loc.name}</div>
                  <div className="text-xs text-n-70">
                    {LOCATION_TYPE_LABELS[loc.type]}
                    {loc.addressDescription && ` · ${loc.addressDescription}`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(loc)}
                    className={`text-xs font-semibold px-2 h-6 rounded-full transition-colors ${
                      loc.active ? 'bg-n-20 text-n-70 hover:bg-signal-red-bg hover:text-signal-red' : 'bg-signal-red-bg text-signal-red hover:bg-ptr-green/10 hover:text-ptr-green'
                    }`}
                  >
                    {loc.active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => (editingId === loc.id ? setEditingId(null) : startEdit(loc))}
                    className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-n-20 hover:text-n-100 transition-colors"
                    aria-label={`Edit ${loc.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: loc.id, name: loc.name })}
                    className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red transition-colors"
                    aria-label={`Delete ${loc.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {editingId === loc.id && (
                <div className="px-4 pb-4 space-y-3 bg-n-10">
                  <LocationFormFields form={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} locations={locations} excludeLocationId={loc.id} ranges={ranges} />
                  <div className="flex gap-2">
                    <button onClick={() => void submitEdit()} disabled={updateLocation.isPending || !editForm.name.trim()} className="btn-primary">Save changes</button>
                    <button onClick={() => setEditingId(null)} className="btn-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete location"
        message={`Delete "${deleteTarget?.name}"? This can't be undone. If it's already used in stock, transactions, purchases, sales, or requests, deactivate it instead.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      </Page>
    </>
  );
}
