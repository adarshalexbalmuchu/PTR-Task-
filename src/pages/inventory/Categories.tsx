import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useInventoryCategories, useInventoryUnits } from '../../hooks/useInventoryCatalog';
import EmptyState from '../../components/EmptyState';
import { Page, PageHeading, SectionTitle } from '../../components/layout/Page';
import { ContextPanel } from '../../components/layout/Slots';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { getErrorMessage } from '../../lib/errors';

export default function InventoryCategories() {
  const { categories, isLoading: categoriesLoading, createCategory } = useInventoryCategories();
  const { units, isLoading: unitsLoading, createUnit } = useInventoryUnits();
  const [newCategory, setNewCategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newUnitAbbr, setNewUnitAbbr] = useState('');
  const [newUnitAllowsFractional, setNewUnitAllowsFractional] = useState(true);

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await createCategory.mutateAsync(newCategory.trim());
      setNewCategory('');
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to add category.'));
    }
  };

  const addUnit = async () => {
    if (!newUnit.trim()) return;
    try {
      await createUnit.mutateAsync({ name: newUnit.trim(), abbreviation: newUnitAbbr.trim(), allowsFractional: newUnitAllowsFractional });
      setNewUnit(''); setNewUnitAbbr(''); setNewUnitAllowsFractional(true);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to add unit.'));
    }
  };

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-6">
      <PageHeading title="Categories & units" meta="Directors can add new ones any time — nothing here needs a schema change." />

      <section>
        <SectionTitle>Categories</SectionTitle>
        <div className="flex gap-2 mb-3 max-w-md">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addCategory(); }}
            className="input-field"
            placeholder="e.g. Linen"
          />
          <button onClick={() => void addCategory()} disabled={createCategory.isPending || !newCategory.trim()} className="btn-primary flex-shrink-0">
            <Plus className="w-4 h-4" />Add
          </button>
        </div>
        {categoriesLoading ? (
          <div className="skeleton h-24" />
        ) : categories.length === 0 ? (
          <EmptyState title="No categories yet" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c.id} className="inline-flex items-center h-8 px-3 rounded-full bg-n-20 text-13 text-n-90">{c.name}</span>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Units of measurement</SectionTitle>
        <div className="flex flex-wrap gap-2 mb-1.5 max-w-md">
          <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} className="input-field flex-1 min-w-[140px]" placeholder="Name (e.g. Bundle)" />
          <input value={newUnitAbbr} onChange={(e) => setNewUnitAbbr(e.target.value)} className="input-field w-24 flex-shrink-0" placeholder="Abbr." />
          <button onClick={() => void addUnit()} disabled={createUnit.isPending || !newUnit.trim()} className="btn-primary flex-shrink-0">
            <Plus className="w-4 h-4" />Add
          </button>
        </div>
        <label className="flex items-center gap-2 text-13 text-n-90 mb-3">
          <input
            type="checkbox" checked={newUnitAllowsFractional}
            onChange={(e) => setNewUnitAllowsFractional(e.target.checked)}
            className="w-4 h-4"
          />
          Allow fractional quantities (uncheck for count-based units like Piece or Box)
        </label>
        {unitsLoading ? (
          <div className="skeleton h-24" />
        ) : units.length === 0 ? (
          <EmptyState title="No units yet" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <span key={u.id} className="inline-flex items-center h-8 px-3 rounded-full bg-n-20 text-13 text-n-90">
                {u.name}{u.abbreviation && ` (${u.abbreviation})`}{!u.allowsFractional && ' · whole numbers only'}
              </span>
            ))}
          </div>
        )}
      </section>
      </Page>
    </>
  );
}
