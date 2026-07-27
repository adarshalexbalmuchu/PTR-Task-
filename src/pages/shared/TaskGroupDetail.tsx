import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, X, ChevronRight, Shield, Repeat, Pause, Play, Square, MoreHorizontal, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import useStore from '../../store/useStore';
import { useTaskGroup } from '../../hooks/useTaskGroup';
import { useGroupMessages } from '../../hooks/useGroupMessages';
import { useUsers } from '../../hooks/useUsers';
import { useRanges } from '../../hooks/useRanges';
import { useIsMobile } from '../../hooks/useIsMobile';
import { canManageTaskGroups } from '../../lib/permissions';
import { isFieldRole } from '../../types';
import Select from '../../components/Select';
import EmptyState from '../../components/EmptyState';
import Tabs from '../../components/ui/Tabs';
import { Menu, MenuItem, MenuDivider } from '../../components/ui/Menu';
import MessageThread from '../../components/MessageThread';
import { Page, PageHeading } from '../../components/layout/Page';
import { getErrorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../utils/formatters';
import { computeFirstOccurrenceDate, computeDueDate } from '../../utils/taskSeriesPreview';
import MobileTaskGroupDetail from '../mobile/MobileTaskGroupDetail';
import type { TaskCategory, TaskPriority, TaskSeries, TaskSeriesRecurrence, TaskSeriesStatus } from '../../types';

const CATEGORIES: TaskCategory[] = ['Patrol', 'Camera Trap', 'Survey', 'Maintenance', 'Admin', 'Other'];
const PRIORITIES: TaskPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const OCCURRENCE_STATUS_LABEL: Record<string, string> = { scheduled: 'Scheduled', active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
const SERIES_STATUS_LABEL: Record<TaskSeriesStatus, string> = { draft: 'Draft', active: 'Active', paused: 'Paused', ended: 'Ended', archived: 'Archived' };
const SERIES_STATUS_TONE: Record<TaskSeriesStatus, string> = {
  draft: 'bg-n-20 text-n-70', active: 'bg-ptr-green/10 text-ptr-green', paused: 'bg-signal-amber/10 text-signal-amber',
  ended: 'bg-n-20 text-n-70', archived: 'bg-n-20 text-n-70',
};
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function RecurrenceSummary({ series }: { series: TaskSeries }) {
  const { recurrenceType, recurrenceRule } = series;
  if (recurrenceType === 'daily') return <>Every day</>;
  if (recurrenceType === 'weekly' || recurrenceType === 'weekdays') {
    const days = (recurrenceRule.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join(', ');
    return <>Every {days || '—'}</>;
  }
  if (recurrenceType === 'monthly') return <>Day {recurrenceRule.dayOfMonth ?? 1} of every month</>;
  return <>Every {recurrenceRule.intervalDays ?? 1} day{(recurrenceRule.intervalDays ?? 1) === 1 ? '' : 's'}</>;
}

function NewAssignmentForm({ groupId, defaultRangeId, onClose }: { groupId: string; defaultRangeId?: string; onClose: () => void }) {
  const { ranges } = useRanges();
  const { createOneTimeAssignment } = useTaskGroup(groupId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('Patrol');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [dueDate, setDueDate] = useState('');
  const [rangeId, setRangeId] = useState(defaultRangeId ?? '');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim() || !dueDate || !rangeId) return;
    try {
      await createOneTimeAssignment.mutateAsync({
        title: title.trim(), description, category, priority, rangeId,
        dueAt: new Date(dueDate + 'T23:59:59').toISOString(),
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the assignment.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {error && <p className="text-13 text-signal-red">{error}</p>}
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="Weekly fire-line inspection" />
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Details</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Category</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className="input-field select-field">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Priority</label>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input-field select-field">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
          <Select value={rangeId} onChange={(e) => setRangeId(e.target.value)} className="input-field select-field">
            <option value="">Select range</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={createOneTimeAssignment.isPending || !title.trim() || !dueDate || !rangeId} className="btn-primary">
          Create assignment
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

function NewRecurringSeriesForm({ groupId, defaultRangeId, onClose }: { groupId: string; defaultRangeId?: string; onClose: () => void }) {
  const { ranges } = useRanges();
  const { createSeries } = useTaskGroup(groupId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('Patrol');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [evidenceRequirements, setEvidenceRequirements] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<TaskSeriesRecurrence>('weekly');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [intervalDays, setIntervalDays] = useState('14');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creationTime, setCreationTime] = useState('06:00');
  const [dueOffsetDays, setDueOffsetDays] = useState('1');
  const [rangeId, setRangeId] = useState(defaultRangeId ?? '');
  const [error, setError] = useState('');

  const toggleWeekday = (d: number) => {
    if (recurrenceType === 'weekly') { setWeekdays([d]); return; }
    setWeekdays((ws) => (ws.includes(d) ? ws.filter((x) => x !== d) : [...ws, d].sort()));
  };

  const valid = title.trim() && startDate && rangeId
    && ((recurrenceType !== 'weekly' && recurrenceType !== 'weekdays') || weekdays.length > 0);

  const firstOccurrence = computeFirstOccurrenceDate(
    recurrenceType,
    { weekdays, dayOfMonth: Number(dayOfMonth) || 1, intervalDays: Number(intervalDays) || 1 },
    startDate,
  );
  const firstDue = firstOccurrence ? computeDueDate(firstOccurrence, Number(dueOffsetDays) || 0) : null;

  const submit = async () => {
    if (!valid) return;
    try {
      await createSeries.mutateAsync({
        title: title.trim(), description, category, priority, evidenceRequirements,
        recurrenceType,
        recurrenceRule:
          recurrenceType === 'weekly' || recurrenceType === 'weekdays' ? { weekdays } :
          recurrenceType === 'monthly' ? { dayOfMonth: Number(dayOfMonth) || 1 } :
          recurrenceType === 'custom_interval' ? { intervalDays: Number(intervalDays) || 1 } : {},
        startDate, endDate: endDate || undefined, creationTime, dueOffsetDays: Number(dueOffsetDays) || 0, rangeId,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the recurring series.'));
    }
  };

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {error && <p className="text-13 text-signal-red">{error}</p>}
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="Weekly fire-line inspection" />
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Details</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Category</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className="input-field select-field">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Priority</label>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input-field select-field">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Evidence requirements (optional)</label>
        <input value={evidenceRequirements} onChange={(e) => setEvidenceRequirements(e.target.value)} className="input-field" placeholder="Photo of the fire line, GPS-tagged" />
      </div>

      <div className="pt-1 border-t border-n-30" />

      <div>
        <label className="block text-13 font-medium text-n-90 mb-1.5">Recurrence</label>
        <Select value={recurrenceType} onChange={(e) => { setRecurrenceType(e.target.value as TaskSeriesRecurrence); setWeekdays([1]); }} className="input-field select-field">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly — one day</option>
          <option value="weekdays">Selected weekdays</option>
          <option value="monthly">Monthly</option>
          <option value="custom_interval">Custom interval</option>
        </Select>
      </div>

      {(recurrenceType === 'weekly' || recurrenceType === 'weekdays') && (
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleWeekday(d)}
              className={`w-11 h-9 rounded text-13 font-medium transition-colors ${weekdays.includes(d) ? 'bg-ptr-green text-white' : 'bg-n-20 text-n-80 hover:bg-n-30'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {recurrenceType === 'monthly' && (
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Day of month</label>
          <input type="number" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="input-field w-28" style={{ fontSize: '16px' }} />
        </div>
      )}
      {recurrenceType === 'custom_interval' && (
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Repeat every N days</label>
          <input type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} className="input-field w-28" style={{ fontSize: '16px' }} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">End date (optional)</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Creates at (IST)</label>
          <input type="time" value={creationTime} onChange={(e) => setCreationTime(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Due after (days)</label>
          <input type="number" min="0" value={dueOffsetDays} onChange={(e) => setDueOffsetDays(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
        </div>
        <div className="col-span-2">
          <label className="block text-13 font-medium text-n-90 mb-1.5">Range</label>
          <Select value={rangeId} onChange={(e) => setRangeId(e.target.value)} className="input-field select-field">
            <option value="">Select range</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
      </div>

      {firstOccurrence && firstDue && (
        <div className="rounded bg-n-10 px-3 py-2 text-13 text-n-90">
          First assignment created <span className="font-medium">{formatDate(firstOccurrence)}</span> at {creationTime} IST · due <span className="font-medium">{formatDate(firstDue)}</span>
        </div>
      )}
      <p className="text-13 text-n-70">Created as a draft — activate it from the series list below once you're ready for it to start generating assignments.</p>

      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={createSeries.isPending || !valid} className="btn-primary">Save as draft</button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export default function TaskGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentUser = useStore((s) => s.currentUser);
  const {
    group, members, occurrences, series, seriesStats, conversationId, isLoading,
    addMember, removeMember, setCoordinator, setSeriesStatus, setGroupStatus, deleteGroup,
  } = useTaskGroup(id);
  const { messages, postMessage, setPinned, redactMessage } = useGroupMessages(conversationId);
  const { users } = useUsers();
  const { ranges } = useRanges();
  const [tab, setTab] = useState('overview');
  const [assignmentFormOpen, setAssignmentFormOpen] = useState(false);
  const [seriesFormOpen, setSeriesFormOpen] = useState(false);
  const [addMemberId, setAddMemberId] = useState('');

  const canManage = canManageTaskGroups(currentUser?.role);
  const isCoordinator = members.some((m) => m.userId === currentUser?.id && m.membershipRole === 'coordinator');
  const canModerate = canManage || isCoordinator;
  const memberIds = new Set(members.map((m) => m.userId));
  const addableUsers = users.filter((u) => isFieldRole(u.role) && !memberIds.has(u.id));
  const rangeName = group?.rangeId ? ranges.find((r) => r.id === group.rangeId)?.name : 'Reserve-wide';

  if (isMobile) return <MobileTaskGroupDetail />;
  if (isLoading) return <Page><div className="skeleton h-40" /></Page>;
  if (!group) return <Page><EmptyState title="Group not found" description="It may have been removed, or you don't have access to it." /></Page>;

  const memberName = (uid: string) => users.find((u) => u.id === uid)?.name ?? '—';

  return (
    <Page className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PageHeading title={group.name} meta={`${group.groupType === 'permanent' ? 'Permanent' : 'Temporary'} · ${rangeName}`} />
        {canManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => { setSeriesFormOpen((o) => !o); setAssignmentFormOpen(false); }} className="btn-subtle"><Repeat className="w-4 h-4" />New recurring task</button>
            <button onClick={() => { setAssignmentFormOpen((o) => !o); setSeriesFormOpen(false); }} className="btn-primary"><Plus className="w-4 h-4" />New assignment</button>
            <Menu ariaLabel="Group actions" align="right" buttonClassName="btn-subtle !px-2" button={<MoreHorizontal className="w-4 h-4" />}>
              {group.status === 'active' && (
                <MenuItem icon={<Pause className="w-4 h-4" />} label="Pause group" onClick={() => setGroupStatus.mutate('paused')} />
              )}
              {group.status === 'paused' && (
                <MenuItem icon={<Play className="w-4 h-4" />} label="Resume group" onClick={() => setGroupStatus.mutate('active')} />
              )}
              {group.status !== 'archived' ? (
                <MenuItem
                  icon={<Archive className="w-4 h-4" />}
                  label="Archive group"
                  onClick={() => { if (confirm(`Archive "${group.name}"? No new assignments can be created until it's unarchived — existing tasks, messages, and history stay exactly as they are.`)) setGroupStatus.mutate('archived'); }}
                />
              ) : (
                <MenuItem icon={<ArchiveRestore className="w-4 h-4" />} label="Unarchive group" onClick={() => setGroupStatus.mutate('active')} />
              )}
              {currentUser?.role === 'director' && (
                <>
                  <MenuDivider />
                  <MenuItem
                    icon={<Trash2 className="w-4 h-4" />}
                    label="Delete permanently"
                    danger
                    onClick={() => {
                      if (confirm(`Permanently delete "${group.name}"? Its members, series, assignments, and discussions will all be deleted. Tasks it already created will NOT be deleted — they'll just no longer be linked to a group. This cannot be undone.`)) {
                        const groupsListPath = window.location.pathname.split('/groups')[0] + '/groups';
                        deleteGroup.mutate(undefined, { onSuccess: () => navigate(groupsListPath) });
                      }
                    }}
                  />
                </>
              )}
            </Menu>
          </div>
        )}
      </div>

      {assignmentFormOpen && <NewAssignmentForm groupId={group.id} defaultRangeId={group.rangeId} onClose={() => setAssignmentFormOpen(false)} />}
      {seriesFormOpen && <NewRecurringSeriesForm groupId={group.id} defaultRangeId={group.rangeId} onClose={() => setSeriesFormOpen(false)} />}

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'assignments', label: 'Assignments', count: occurrences.length },
          { id: 'members', label: 'Members', count: members.length },
          { id: 'discussion', label: 'Discussion', count: messages.length || undefined },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="space-y-3">
          {group.description && <p className="text-13 text-n-90">{group.description}</p>}
          <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><div className="text-xs text-n-70">Members</div><div className="text-xl font-semibold text-n-100">{members.length}</div></div>
            <div><div className="text-xs text-n-70">Active assignments</div><div className="text-xl font-semibold text-n-100">{occurrences.filter((o) => o.status === 'scheduled' || o.status === 'active').length}</div></div>
            <div><div className="text-xs text-n-70">Coordinators</div><div className="text-xl font-semibold text-n-100">{members.filter((m) => m.membershipRole === 'coordinator').length}</div></div>
            <div><div className="text-xs text-n-70">Status</div><div className="text-xl font-semibold text-n-100 capitalize">{group.status}</div></div>
          </div>
          {Object.keys(seriesStats).length > 0 && (
            <div>
              <div className="text-13 font-semibold text-n-90 mb-2">Series performance</div>
              <div className="card divide-y divide-n-20">
                {series.filter((s) => seriesStats[s.id]).map((s) => {
                  const stats = seriesStats[s.id];
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-13 font-medium text-n-100 truncate">{s.title}</div>
                        <div className="text-xs text-n-70">{stats.total} assignment{stats.total === 1 ? '' : 's'} generated · {stats.completed} completed · {stats.inProgress} in progress</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-semibold text-ptr-green">{stats.completionRate}%</div>
                        <div className="text-xs text-n-70">completion</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {occurrences.length > 0 && (
            <div>
              <div className="text-13 font-semibold text-n-90 mb-2">Recent activity</div>
              <div className="card divide-y divide-n-20">
                {occurrences.slice(0, 5).map((o) => (
                  <button key={o.id} onClick={() => navigate(`occurrences/${o.id}`)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-n-10">
                    <div className="min-w-0">
                      <div className="text-13 font-medium text-n-100 truncate">{o.title}</div>
                      <div className="text-xs text-n-70">Due {formatDate(o.dueAt)} · {OCCURRENCE_STATUS_LABEL[o.status]}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-n-50 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'assignments' && (
        <div className="space-y-5">
          <div>
            <div className="text-13 font-semibold text-n-90 mb-2">Recurring series</div>
            {series.length === 0 ? (
              <p className="text-13 text-n-70">No recurring series yet.</p>
            ) : (
              <div className="card divide-y divide-n-20">
                {series.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-n-100 truncate">{s.title}</div>
                      <div className="text-13 text-n-70"><RecurrenceSummary series={s} /> · due {s.dueOffsetDays}d after · starts {formatDate(s.startDate)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 h-6 rounded-full flex items-center ${SERIES_STATUS_TONE[s.status]}`}>{SERIES_STATUS_LABEL[s.status]}</span>
                      {canManage && (s.status === 'draft' || s.status === 'paused') && (
                        <button onClick={() => setSeriesStatus.mutate({ seriesId: s.id, status: 'active' })} className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-n-20" aria-label="Activate" title="Activate"><Play className="w-4 h-4" /></button>
                      )}
                      {canManage && s.status === 'active' && (
                        <button onClick={() => setSeriesStatus.mutate({ seriesId: s.id, status: 'paused' })} className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-n-20" aria-label="Pause" title="Pause"><Pause className="w-4 h-4" /></button>
                      )}
                      {canManage && (s.status === 'active' || s.status === 'paused') && (
                        <button
                          onClick={() => { if (confirm(`End "${s.title}"? No further assignments will be generated.`)) setSeriesStatus.mutate({ seriesId: s.id, status: 'ended' }); }}
                          className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red"
                          aria-label="End" title="End"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-13 font-semibold text-n-90 mb-2">Assignments</div>
            {occurrences.length === 0 ? (
              <EmptyState title="No assignments yet" description={canManage ? 'Create a one-time assignment to give every member their own task.' : undefined} />
            ) : (
              <div className="card divide-y divide-n-20">
                {occurrences.map((o) => (
                  <button key={o.id} onClick={() => navigate(`occurrences/${o.id}`)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-n-10">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-n-100 truncate">{o.title}{o.seriesId ? ' · recurring' : ''}</div>
                      <div className="text-13 text-n-70">Due {formatDateTime(o.dueAt)}</div>
                    </div>
                    <span className={`text-xs font-medium px-2 h-6 rounded-full flex items-center flex-shrink-0 ${o.status === 'cancelled' ? 'bg-n-20 text-n-70' : o.status === 'completed' ? 'bg-ptr-green/10 text-ptr-green' : 'bg-signal-amber/10 text-signal-amber'}`}>
                      {OCCURRENCE_STATUS_LABEL[o.status]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'members' && (
        <div className="space-y-3">
          {canManage && (
            <div className="card p-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label className="block text-13 font-medium text-n-90 mb-1.5">Add member</label>
                <Select value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)} className="input-field select-field">
                  <option value="">Select a person</option>
                  {addableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </div>
              <button
                onClick={() => { if (addMemberId) { addMember.mutate(addMemberId); setAddMemberId(''); } }}
                disabled={!addMemberId || addMember.isPending}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />Add
              </button>
            </div>
          )}
          {members.length === 0 ? (
            <EmptyState title="No members yet" />
          ) : (
            <div className="card divide-y divide-n-20">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-13 font-medium text-n-100 truncate">{memberName(m.userId)}</span>
                    {m.membershipRole === 'coordinator' && (
                      <span className="text-xs font-medium px-1.5 h-5 rounded-full flex items-center bg-ptr-accent/10 text-ptr-accent flex-shrink-0"><Shield className="w-3 h-3 mr-0.5" />Coordinator</span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setCoordinator.mutate({ memberRowId: m.id, isCoordinator: m.membershipRole !== 'coordinator' })}
                        className="text-13 text-ptr-accent font-medium px-2 h-8 rounded hover:bg-n-20"
                      >
                        {m.membershipRole === 'coordinator' ? 'Remove as coordinator' : 'Make coordinator'}
                      </button>
                      <button
                        onClick={() => { if (confirm(`Remove ${memberName(m.userId)} from this group?`)) removeMember.mutate(m.id); }}
                        className="w-8 h-8 flex items-center justify-center rounded text-n-70 hover:bg-signal-red-bg hover:text-signal-red"
                        aria-label={`Remove ${memberName(m.userId)}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'discussion' && currentUser && (
        <div className="card p-4">
          <MessageThread
            messages={messages}
            users={users}
            currentUser={currentUser}
            canPost={canManage || group.membersCanReply || isCoordinator}
            disabledReason="Only coordinators and officers can post announcements in this group."
            onSend={(body) => postMessage.mutateAsync(body)}
            emptyLabel="No announcements yet."
            onPin={canModerate ? (messageId, pinned) => setPinned.mutateAsync({ messageId, pinned }) : undefined}
            onRedact={(messageId) => redactMessage.mutateAsync(messageId)}
          />
        </div>
      )}
    </Page>
  );
}
