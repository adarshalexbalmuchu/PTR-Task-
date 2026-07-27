import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useInventoryItems, useInventoryCategories, useInventoryUnits } from '../../hooks/useInventoryCatalog';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage } from '../../lib/errors';
import { quantityInputStep, isIntegerOnlyUnit } from '../../lib/inventoryQuantity';
import type { InventoryItemKind } from '../../types';

export default function InventoryItems() {
  const { items, isLoading, createItem } = useInventoryItems();
  const { categories } = useInventoryCategories();
  const { units } = useInventoryUnits();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [kind, setKind] = useState<InventoryItemKind>('consumable');
  const [minStock, setMinStock] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('0');

  const reset = () => { setName(''); setCategoryId(''); setUnitId(''); setKind('consumable'); setMinStock('0'); setReorderLevel('0'); };

  const selectedUnit = units.find((u) => u.id === unitId);

  const submit = async () => {
    if (!name.trim() || !categoryId || !unitId) return;
    const minStockNum = Number(minStock) || 0;
    const reorderLevelNum = Number(reorderLevel) || 0;
    if (isIntegerOnlyUnit(selectedUnit?.allowsFractional) && (!Number.isInteger(minStockNum) || !Number.isInteger(reorderLevelNum))) {
      alert(`Minimum stock and reorder level must be whole numbers for this unit${selectedUnit ? ` (${selectedUnit.abbreviation || selectedUnit.name})` : ''}.`);
      return;
    }
    try {
      await createItem.mutateAsync({
        name: name.trim(), categoryId, unitId, kind,
        minStock: minStockNum, reorderLevel: reorderLevelNum,
      });
      reset();
      setFormOpen(false);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to create item.'));
    }
  };

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-6">
      <CommandBar>
        <button onClick={() => setFormOpen((o) => !o)} className="btn-primary"><Plus className="w-4 h-4" />New item</button>
      </CommandBar>

      <PageHeading title="Item catalogue" meta={`${items.length} item${items.length === 1 ? '' : 's'}`} />

      {formOpen && (
        <div className="card p-4 space-y-3 max-w-xl">
          {(categories.length === 0 || units.length === 0) && (
            <p className="text-13 text-signal-amber">Add at least one category and unit first (Categories &amp; units page).</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-13 font-medium text-n-90 mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Bedsheets" />
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Category</label>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-field select-field">
                <option value="">Select category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Unit</label>
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="input-field select-field">
                <option value="">Select unit</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Kind</label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as InventoryItemKind)} className="input-field select-field">
                <option value="consumable">Consumable</option>
                <option value="reusable">Reusable</option>
              </Select>
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Minimum stock</label>
              <input type="number" min="0" step={quantityInputStep(selectedUnit?.allowsFractional)} value={minStock} onChange={(e) => setMinStock(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-13 font-medium text-n-90 mb-1.5">Reorder level</label>
              <input type="number" min="0" step={quantityInputStep(selectedUnit?.allowsFractional)} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="input-field" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void submit()} disabled={createItem.isPending || !name.trim() || !categoryId || !unitId} className="btn-primary">Create</button>
            <button onClick={() => { setFormOpen(false); reset(); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : items.length === 0 ? (
        <EmptyState title="No items yet" description="Add your first item to the catalogue." />
      ) : (
        <div className="card divide-y divide-n-20">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-13 font-semibold text-n-100 truncate">{item.name}</div>
                <div className="text-xs text-n-70">
                  {item.categoryName ?? '—'} · {item.unitAbbreviation ?? '—'} · {item.kind === 'consumable' ? 'Consumable' : 'Reusable'}
                  {!item.active && ' · Inactive'}
                </div>
              </div>
              <div className="text-xs text-n-70 flex-shrink-0">Min {item.minStock} · Reorder {item.reorderLevel}</div>
            </div>
          ))}
        </div>
      )}
      </Page>
    </>
  );
}
