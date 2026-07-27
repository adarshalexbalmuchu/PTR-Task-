import { useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '../../types';

// A searchable item combobox — the plain native <select> became unusable
// once the catalog had 30+ items (a long alphabetical scroll with no way
// to jump to what you're after). Type to filter by name; click a result to
// select it. Controlled the same way a <select> is (value = item id).
export default function ItemPicker({
  items, value, onChange, placeholder,
}: {
  items: InventoryItem[];
  value: string;
  onChange: (itemId: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = items.find((it) => it.id === value);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <input
        value={open ? query : (selected?.name ?? '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder ?? 'Search items…'}
        className="input-field w-full"
        style={{ fontSize: '16px' }}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-n-30 rounded-lg shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-13 text-n-70">No items match "{query}"</div>
          ) : (
            filtered.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => { onChange(it.id); setQuery(''); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-13 hover:bg-n-10 ${it.id === value ? 'bg-ptr-green/10 text-ptr-green font-medium' : 'text-n-90'}`}
              >
                {it.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
