import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users as UsersIcon } from 'lucide-react';
import useStore from '../../store/useStore';
import { useTaskGroups } from '../../hooks/useTaskGroups';
import { useRanges } from '../../hooks/useRanges';
import { useIsMobile } from '../../hooks/useIsMobile';
import { canManageTaskGroups } from '../../lib/permissions';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import MobileTaskGroupsList from '../mobile/MobileTaskGroupsList';
import { getErrorMessage } from '../../lib/errors';
import type { TaskGroup, TaskGroupType } from '../../types';

type Filter = 'active' | 'permanent' | 'temporary' | 'mine' | 'archived';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'mine', label: 'My groups' },
  { value: 'archived', label: 'Archived' },
];

const GROUP_TYPE_LABEL: Record<TaskGroupType, string> = { permanent: 'Permanent', temporary: 'Temporary' };

function NewGroupForm({ onClose }: { onClose: () => void }) {
  const { ranges } = useRanges();
  const { createGroup } = useTaskGroups();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState<TaskGroupType>('permanent');
  const [rangeId, setRangeId] = useState('');
  const [membersCanReply, setMembersCanReply] = useState(true);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await createGroup.mutateAsync({ name: name.trim(), description, groupType, rangeId: rangeId || undefined, membersCanReply });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the group.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {error && <p className="text-13 text-signal-red">{error}</p>}
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Group name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Betla Weekly Patrol Team" />
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Purpose</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Type</label>
          <Select value={groupType} onChange={(e) => setGroupType(e.target.value as TaskGroupType)} className="input-field select-field">
            <option value="permanent">Permanent — reused for repeated work</option>
            <option value="temporary">Temporary — one campaign, then archives</option>
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
          <Select value={rangeId} onChange={(e) => setRangeId(e.target.value)} className="input-field select-field">
            <option value="">Reserve-wide (director only)</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2.5 py-1">
        <input type="checkbox" checked={membersCanReply} onChange={(e) => setMembersCanReply(e.target.checked)} className="w-5 h-5 accent-ptr-green" />
        <span className="text-13 text-n-90">Members can post in the discussion (not just coordinators)</span>
      </label>
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={createGroup.isPending || !name.trim()} className="btn-primary">Create group</button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export default function TaskGroupsList() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentUser = useStore((s) => s.currentUser);
  const { groups, isLoading } = useTaskGroups();
  const { ranges } = useRanges();
  const [filter, setFilter] = useState<Filter>('active');
  const [formOpen, setFormOpen] = useState(false);

  const canManage = canManageTaskGroups(currentUser?.role);

  const matches = (g: TaskGroup) => {
    if (filter === 'active') return g.status !== 'archived';
    if (filter === 'permanent') return g.groupType === 'permanent' && g.status !== 'archived';
    if (filter === 'temporary') return g.groupType === 'temporary' && g.status !== 'archived';
    if (filter === 'mine') return g.createdBy === currentUser?.id;
    if (filter === 'archived') return g.status === 'archived';
    return true;
  };
  const filtered = groups.filter(matches);
  const rangeName = (id?: string) => (id ? ranges.find((r) => r.id === id)?.name : undefined);

  if (isMobile) return <MobileTaskGroupsList />;

  return (
    <>
      <Page className="space-y-4">
        <CommandBar>
          {canManage && (
            <button onClick={() => setFormOpen((o) => !o)} className="btn-primary"><Plus className="w-4 h-4" />New group</button>
          )}
        </CommandBar>

        <ContextPanel>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-n-70">Filter</div>
          <div className="space-y-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`w-full text-left px-2.5 h-8 rounded text-13 flex items-center transition-colors ${filter === f.value ? 'bg-ptr-green/10 text-ptr-green font-semibold' : 'text-n-90 hover:bg-n-20'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </ContextPanel>

        <PageHeading title="Task Groups" meta={`${filtered.length} group${filtered.length === 1 ? '' : 's'}`} />

        {formOpen && <NewGroupForm onClose={() => setFormOpen(false)} />}

        {isLoading ? (
          <div className="skeleton h-40" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="w-6 h-6" />}
            title="No Task Groups yet"
            description={canManage ? 'Create a permanent or temporary team to assign work to repeatedly.' : 'You are not yet a member of any Task Group.'}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(g.id)}
                className="card p-4 text-left hover:border-ptr-green/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-n-100 truncate">{g.name}</span>
                  {g.status !== 'active' && (
                    <span className={`text-xs font-medium px-2 h-5 rounded-full flex items-center flex-shrink-0 ${g.status === 'archived' ? 'bg-n-20 text-n-70' : 'bg-signal-amber/10 text-signal-amber'}`}>
                      {g.status === 'archived' ? 'Archived' : 'Paused'}
                    </span>
                  )}
                </div>
                <div className="text-13 text-n-70 mt-1">
                  {GROUP_TYPE_LABEL[g.groupType]} · {g.memberCount ?? 0} member{(g.memberCount ?? 0) === 1 ? '' : 's'}
                  {rangeName(g.rangeId) ? ` · ${rangeName(g.rangeId)}` : ' · Reserve-wide'}
                </div>
                <div className="text-13 text-n-80 mt-1.5">
                  {g.activeOccurrenceCount ?? 0} active assignment{(g.activeOccurrenceCount ?? 0) === 1 ? '' : 's'}
                </div>
              </button>
            ))}
          </div>
        )}
      </Page>
    </>
  );
}
