import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users as UsersIcon } from 'lucide-react';
import useStore from '../../store/useStore';
import { useTaskGroups } from '../../hooks/useTaskGroups';
import { useRanges } from '../../hooks/useRanges';
import { canManageTaskGroups } from '../../lib/permissions';
import FilterChips from '../../components/mobile/FilterChips';
import BottomSheet from '../../components/mobile/BottomSheet';
import Select from '../../components/Select';
import { getErrorMessage } from '../../lib/errors';
import type { TaskGroup, TaskGroupType } from '../../types';

type Chip = 'active' | 'permanent' | 'temporary' | 'mine' | 'archived';
const GROUP_TYPE_LABEL: Record<TaskGroupType, string> = { permanent: 'Permanent', temporary: 'Temporary' };

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ranges } = useRanges();
  const { createGroup } = useTaskGroups();
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<TaskGroupType>('permanent');
  const [rangeId, setRangeId] = useState('');
  const [membersCanReply, setMembersCanReply] = useState(true);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await createGroup.mutateAsync({ name: name.trim(), groupType, rangeId: rangeId || undefined, membersCanReply });
      setName(''); setRangeId('');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the group.'));
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="New Task Group">
      <div className="p-4 space-y-3">
        {error && <p className="text-13 text-signal-red">{error}</p>}
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Group name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" style={{ fontSize: '16px' }} placeholder="Betla Weekly Patrol Team" />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Type</label>
          <Select value={groupType} onChange={(e) => setGroupType(e.target.value as TaskGroupType)} className="input-field select-field">
            <option value="permanent">Permanent</option>
            <option value="temporary">Temporary</option>
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
          <Select value={rangeId} onChange={(e) => setRangeId(e.target.value)} className="input-field select-field">
            <option value="">Reserve-wide (director only)</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2.5 py-1">
          <input type="checkbox" checked={membersCanReply} onChange={(e) => setMembersCanReply(e.target.checked)} className="w-5 h-5 accent-ptr-green" />
          <span className="text-13 text-n-90">Members can post in the discussion (not just coordinators)</span>
        </label>
        <button onClick={() => void submit()} disabled={createGroup.isPending || !name.trim()} className="btn-primary w-full">Create group</button>
      </div>
    </BottomSheet>
  );
}

export default function MobileTaskGroupsList() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const { groups, isLoading } = useTaskGroups();
  const { ranges } = useRanges();
  const [chip, setChip] = useState<Chip>('active');
  const [formOpen, setFormOpen] = useState(false);

  const canManage = canManageTaskGroups(currentUser?.role);
  const matches = (g: TaskGroup) => {
    if (chip === 'active') return g.status !== 'archived';
    if (chip === 'permanent') return g.groupType === 'permanent' && g.status !== 'archived';
    if (chip === 'temporary') return g.groupType === 'temporary' && g.status !== 'archived';
    if (chip === 'mine') return g.createdBy === currentUser?.id;
    if (chip === 'archived') return g.status === 'archived';
    return true;
  };
  const filtered = groups.filter(matches);
  const rangeName = (id?: string) => (id ? ranges.find((r) => r.id === id)?.name : undefined);

  return (
    <div>
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-n-100">Task Groups</h1>
          <p className="text-13 text-n-70 mt-0.5">Standing teams & campaign groups</p>
        </div>
        {canManage && (
          <button onClick={() => setFormOpen(true)} className="w-12 h-12 flex items-center justify-center rounded-full bg-ptr-green text-white flex-shrink-0 active:bg-ptr-green-dark" aria-label="New group">
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>

      <FilterChips
        chips={[
          { id: 'active', label: 'Active', count: groups.filter((g) => g.status !== 'archived').length },
          { id: 'permanent', label: 'Permanent', count: groups.filter((g) => g.groupType === 'permanent' && g.status !== 'archived').length },
          { id: 'temporary', label: 'Temporary', count: groups.filter((g) => g.groupType === 'temporary' && g.status !== 'archived').length },
          { id: 'mine', label: 'My groups', count: groups.filter((g) => g.createdBy === currentUser?.id).length },
          { id: 'archived', label: 'Archived', count: groups.filter((g) => g.status === 'archived').length },
        ]}
        active={chip}
        onChange={(id) => setChip(id as Chip)}
      />

      {isLoading ? (
        <div className="px-4 space-y-3 mt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2"><div className="skeleton h-4 w-1/2" /><div className="skeleton h-3 w-full" /></div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-n-20 flex items-center justify-center mb-3 text-n-70"><UsersIcon className="w-5 h-5" /></div>
          <div className="text-[15px] font-semibold text-n-100">No Task Groups</div>
          <div className="text-13 text-n-70 mt-1">{canManage ? 'Tap + to create a team.' : "You're not a member of any group yet."}</div>
        </div>
      ) : (
        <div className="mt-1">
          {filtered.map((g) => (
            <button key={g.id} onClick={() => navigate(g.id)} className="w-full text-left px-4 py-3 border-b border-n-20 last:border-0 active:bg-n-10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-n-100 truncate">{g.name}</span>
                {g.status !== 'active' && (
                  <span className={`text-xs font-medium px-2 h-5 rounded-full flex items-center flex-shrink-0 ${g.status === 'archived' ? 'bg-n-20 text-n-70' : 'bg-signal-amber/10 text-signal-amber'}`}>
                    {g.status === 'archived' ? 'Archived' : 'Paused'}
                  </span>
                )}
              </div>
              <div className="text-13 text-n-70 mt-0.5">
                {GROUP_TYPE_LABEL[g.groupType]} · {g.memberCount ?? 0} member{(g.memberCount ?? 0) === 1 ? '' : 's'}{rangeName(g.rangeId) ? ` · ${rangeName(g.rangeId)}` : ''}
              </div>
              <div className="text-13 text-n-80 mt-1">{g.activeOccurrenceCount ?? 0} active assignment{(g.activeOccurrenceCount ?? 0) === 1 ? '' : 's'}</div>
            </button>
          ))}
          <div className="h-4" />
        </div>
      )}

      <NewGroupSheet open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
