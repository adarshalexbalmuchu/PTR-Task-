import { useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { useUsers } from '../../hooks/useUsers';
import { useRanges } from '../../hooks/useRanges';
import Select from '../../components/Select';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import type { User, Role } from '../../types';

// inventory_staff is DEPRECATED (see schema.sql) — Inventory access is now
// an additional capability any guard can be granted via Inventory managers
// (Director → Inventory → Inventory managers), not a separate role. These
// Record<Role, ...> maps still need an entry for it purely so this stays
// exhaustive against the Postgres enum (which can't be safely dropped
// while live); the role is deliberately absent from the create/edit
// dropdown below so no new user can ever be given it.
const ROLE_LABELS: Record<Role, string> = {
  director: 'Director',
  range_officer: 'Range Officer',
  guard: 'Guard / Field Staff',
  range_office: 'Range Office',
  tiger_cell: 'Tiger Cell',
  divisional_office: 'Divisional Office',
  inventory_staff: 'Inventory Staff (deprecated)',
};

// Director gets the one brand-color highlight (top authority); the other
// roles stay neutral — role is already legible from the label text.
const ROLE_COLORS: Record<Role, string> = {
  director: 'bg-ptr-green/10 text-ptr-green border border-ptr-green/20',
  range_officer: 'bg-white text-ptr-brown border border-ptr-cream-dark',
  guard: 'bg-white text-ptr-brown-light border border-ptr-cream-dark',
  range_office: 'bg-white text-ptr-brown-light border border-ptr-cream-dark',
  tiger_cell: 'bg-white text-ptr-brown-light border border-ptr-cream-dark',
  divisional_office: 'bg-white text-ptr-brown-light border border-ptr-cream-dark',
  inventory_staff: 'bg-white text-ptr-brown-light border border-ptr-cream-dark',
};

// Director works reserve-wide and Tiger Cell staff (research/tech roles that
// span ranges) aren't posted to one range either — both skip the field.
// Divisional Office, like Range Office, is posted to one specific range.
const ROLE_HAS_NO_RANGE: Record<Role, boolean> = {
  director: true,
  range_officer: false,
  guard: false,
  range_office: false,
  tiger_cell: true,
  divisional_office: false,
  inventory_staff: true,
};

interface UserFormData {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: Role;
  rangeId: string;
  designation: string;
}

function UserFormModal({
  initial,
  onSave,
  onClose,
  submitError,
  saving,
}: {
  initial?: User | null;
  onSave: (data: UserFormData) => void;
  onClose: () => void;
  submitError?: string;
  saving?: boolean;
}) {
  const { ranges } = useRanges();
  const [form, setForm] = useState<UserFormData>({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    phone: initial?.phone ?? '',
    role: initial?.role ?? 'guard',
    rangeId: initial?.rangeId ?? '',
    designation: initial?.designation ?? '',
  });
  const [errors, setErrors] = useState<Partial<UserFormData>>({});

  const set = <K extends keyof UserFormData>(k: K, v: UserFormData[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const validate = (): boolean => {
    const errs: Partial<UserFormData> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!initial && !form.email.trim()) errs.email = 'Email is required';
    if (!initial) {
      // Must stay in sync with the create-user Edge Function, which
      // enforces the same rule server-side.
      if (!form.password.trim()) errs.password = 'Password is required';
      else if (form.password.length < 10) errs.password = 'Password must be at least 10 characters';
      else if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password))
        errs.password = 'Password must contain both letters and numbers';
    }
    if (!form.designation.trim()) errs.designation = 'Designation is required';
    if (!ROLE_HAS_NO_RANGE[form.role] && !form.rangeId) errs.rangeId = 'Range is required for this role';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-ptr-cream-dark">
          <h2 className="text-lg font-semibold text-ptr-brown">{initial ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ptr-cream transition-colors">
            <X className="w-5 h-5 text-ptr-brown-light" />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Full Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={`input-field ${errors.name ? 'input-error' : ''}`}
              placeholder="e.g. Ramesh Kumar"
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">
              Email {!initial && <span className="text-red-500">*</span>}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className={`input-field ${errors.email ? 'input-error' : ''} ${initial ? 'opacity-60 cursor-not-allowed' : ''}`}
              placeholder="e.g. staff@ptr.in"
              disabled={!!initial}
            />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
          </div>
          {!initial && (
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">Password <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                className={`input-field ${errors.password ? 'input-error' : ''}`}
                placeholder="Minimum 10 characters, letters and numbers"
              />
              {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              className="input-field"
              placeholder="10-digit mobile number"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Designation <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.designation}
              onChange={(e) => set('designation', e.target.value)}
              className={`input-field ${errors.designation ? 'input-error' : ''}`}
              placeholder="e.g. Forest Guard, Range Officer"
            />
            {errors.designation && <p className="text-xs text-red-600 mt-1">{errors.designation}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">Role</label>
              <Select
                value={form.role}
                onChange={(e) => set('role', e.target.value as Role)}
                className="input-field select-field"
              >
                <option value="director">Director</option>
                <option value="range_officer">Range Officer</option>
                <option value="guard">Guard / Field Staff</option>
                <option value="range_office">Range Office</option>
                <option value="tiger_cell">Tiger Cell</option>
                <option value="divisional_office">Divisional Office</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">
                Range {!ROLE_HAS_NO_RANGE[form.role] && <span className="text-red-500">*</span>}
              </label>
              <Select
                value={form.rangeId}
                onChange={(e) => set('rangeId', e.target.value)}
                disabled={ROLE_HAS_NO_RANGE[form.role]}
                className={`input-field select-field ${errors.rangeId ? 'input-error' : ''}`}
              >
                <option value="">{ROLE_HAS_NO_RANGE[form.role] ? 'N/A' : 'Select range'}</option>
                {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              {errors.rangeId && <p className="text-xs text-red-600 mt-1">{errors.rangeId}</p>}
            </div>
          </div>
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
              {submitError}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2 border-t border-ptr-cream-dark">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => { if (validate()) onSave(form); }}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DirectorUsers() {
  const { users, createUser, updateUser, deleteUser } = useUsers();
  const { ranges } = useRanges();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState('');

  const filtered = filterRole ? users.filter((u) => u.role === filterRole) : users;

  const handleSave = (data: UserFormData) => {
    const initials = data.name
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .slice(0, 2)
      .join('');
    const rangeId = ROLE_HAS_NO_RANGE[data.role] ? undefined : data.rangeId || undefined;
    const onSuccess = () => { setFormOpen(false); setEditing(null); };

    if (editing) {
      updateUser.mutate(
        { id: editing.id, name: data.name, role: data.role, phone: data.phone || undefined, designation: data.designation, avatarInitials: initials, rangeId },
        { onSuccess },
      );
    } else {
      createUser.mutate(
        { email: data.email, password: data.password, name: data.name, role: data.role, phone: data.phone || undefined, designation: data.designation, avatarInitials: initials, rangeId },
        { onSuccess },
      );
    }
  };

  const handleDelete = (user: User) => {
    if (confirm(`Delete ${user.name}? This cannot be undone.`)) {
      deleteUser.mutate(user.id, {
        onError: (err) => alert(`Failed to delete user: ${err.message}`),
      });
    }
  };

  const ROLE_FILTERS: { value: string; label: string }[] = [
    { value: '', label: 'All roles' },
    { value: 'director', label: 'Director' },
    { value: 'range_officer', label: 'Range officer' },
    { value: 'guard', label: 'Guard / field staff' },
    { value: 'range_office', label: 'Range office' },
    { value: 'tiger_cell', label: 'Tiger cell' },
    { value: 'divisional_office', label: 'Divisional office' },
  ];

  return (
    <>
      <Page className="space-y-4">
        <CommandBar>
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary"><Plus className="w-4 h-4" />Add user</button>
        </CommandBar>

        <ContextPanel>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-n-70">Role</div>
          <div className="space-y-0.5">
            {ROLE_FILTERS.map((o) => {
              const active = o.value === filterRole;
              return (
                <button key={o.value || 'all'} onClick={() => setFilterRole(o.value)} className={`w-full text-left px-2.5 h-8 rounded text-13 flex items-center transition-colors ${active ? 'bg-ptr-green/10 text-ptr-green font-semibold' : 'text-n-90 hover:bg-n-20'}`}>{o.label}</button>
              );
            })}
          </div>
        </ContextPanel>

        <PageHeading title="Personnel" meta={`${filtered.length} of ${users.length} staff`} />

        <div className="card divide-y divide-n-20 overflow-hidden">
          {filtered.map((user) => {
            const range = ranges.find((r) => r.id === user.rangeId);
            return (
              <div key={user.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-n-10 transition-colors">
                <div className="w-9 h-9 rounded-full bg-ptr-green/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-ptr-green">{user.avatarInitials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-13 font-medium text-n-100 truncate">{user.name}</div>
                  <div className="text-xs text-n-70 truncate">
                    {user.designation}{range ? ` · ${range.name}` : ''} · {user.email}
                  </div>
                </div>
                <span className={`text-xs font-medium rounded px-2 py-0.5 flex-shrink-0 ${ROLE_COLORS[user.role]}`}>
                  {ROLE_LABELS[user.role]}
                </span>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditing(user); setFormOpen(true); }} className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-n-20 hover:text-n-100 transition-colors" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(user)} className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red transition-colors" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Page>

      {formOpen && (
        <UserFormModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          submitError={(editing ? updateUser.error : createUser.error)?.message}
          saving={editing ? updateUser.isPending : createUser.isPending}
        />
      )}
    </>
  );
}
