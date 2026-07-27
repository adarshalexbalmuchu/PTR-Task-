import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useInventoryLocations } from '../../hooks/useInventoryLocations';
import { useRanges } from '../../hooks/useRanges';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage } from '../../lib/errors';
import type { InventoryLocationType } from '../../types';

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

export default function InventoryLocations() {
  const { locations, isLoading, createLocation } = useInventoryLocations();
  const { ranges } = useRanges();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<InventoryLocationType>('range_store');
  const [rangeId, setRangeId] = useState('');
  const [addressDescription, setAddressDescription] = useState('');
  const [parentLocationId, setParentLocationId] = useState('');

  const reset = () => { setName(''); setType('range_store'); setRangeId(''); setAddressDescription(''); setParentLocationId(''); };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await createLocation.mutateAsync({
        name: name.trim(), type, rangeId: rangeId || undefined,
        addressDescription: addressDescription.trim() || undefined,
        parentLocationId: parentLocationId || undefined,
      });
      reset();
      setFormOpen(false);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to create location.'));
    }
  };

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-6">
      <CommandBar>
        <button onClick={() => setFormOpen((o) => !o)} className="btn-primary">
          <Plus className="w-4 h-4" />New location
        </button>
      </CommandBar>

      <PageHeading title="Inventory locations" meta={`${locations.length} location${locations.length === 1 ? '' : 's'}`} />

      {formOpen && (
        <div className="card p-4 space-y-3 max-w-xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Betla Resort" />
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Type</label>
              <Select value={type} onChange={(e) => setType(e.target.value as InventoryLocationType)} className="input-field select-field">
                {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
              <Select value={rangeId} onChange={(e) => setRangeId(e.target.value)} className="input-field select-field">
                <option value="">None</option>
                {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Parent location</label>
              <Select value={parentLocationId} onChange={(e) => setParentLocationId(e.target.value)} className="input-field select-field">
                <option value="">None</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Address / description</label>
            <input value={addressDescription} onChange={(e) => setAddressDescription(e.target.value)} className="input-field" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void submit()} disabled={createLocation.isPending || !name.trim()} className="btn-primary">Create</button>
            <button onClick={() => { setFormOpen(false); reset(); }} className="btn-secondary">Cancel</button>
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
            <div key={loc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-13 font-semibold text-n-100 truncate">{loc.name}</div>
                <div className="text-xs text-n-70">
                  {LOCATION_TYPE_LABELS[loc.type]}
                  {loc.addressDescription && ` · ${loc.addressDescription}`}
                  {!loc.active && ' · Inactive'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </Page>
    </>
  );
}
