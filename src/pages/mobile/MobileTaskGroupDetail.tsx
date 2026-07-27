import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, X, ChevronRight, Shield, Repeat, Play, Pause, Square, MoreVertical, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import useStore from '../../store/useStore';
import { useTaskGroup } from '../../hooks/useTaskGroup';
import { useGroupMessages } from '../../hooks/useGroupMessages';
import { useUsers } from '../../hooks/useUsers';
import { useRanges } from '../../hooks/useRanges';
import { canManageTaskGroups } from '../../lib/permissions';
import { isFieldRole } from '../../types';
import Select from '../../components/Select';
import Tabs from '../../components/ui/Tabs';
import MessageThread from '../../components/MessageThread';
import BottomSheet from '../../components/mobile/BottomSheet';
import { getErrorMessage } from '../../lib/errors';
import { formatDate } from '../../utils/formatters';
import { computeFirstOccurrenceDate, computeDueDate } from '../../utils/taskSeriesPreview';
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
    return <>Every {(recurrenceRule.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join(', ') || '—'}</>;
  }
  if (recurrenceType === 'monthly') return <>Day {recurrenceRule.dayOfMonth ?? 1} of every month</>;
  return <>Every {recurrenceRule.intervalDays ?? 1}d</>;
}

function NewAssignmentSheet({ open, onClose, groupId, defaultRangeId }: { open: boolean; onClose: () => void; groupId: string; defaultRangeId?: string }) {
  const { ranges } = useRanges();
  const { createOneTimeAssignment } = useTaskGroup(groupId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('Patrol');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [dueDate, setDueDate] = useState('');
  const [rangeId, setRangeId] = useState(defaultRangeId ?? '');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim() || !dueDate || !rangeId) return;
    try {
      await createOneTimeAssignment.mutateAsync({ title: title.trim(), category, priority, rangeId, dueAt: new Date(dueDate + 'T23:59:59').toISOString() });
      setTitle(''); setDueDate('');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the assignment.'));
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="New assignment">
      <div className="p-4 space-y-3">
        {error && <p className="text-13 text-signal-red">{error}</p>}
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" style={{ fontSize: '16px' }} placeholder="Weekly fire-line inspection" />
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
        <button onClick={() => void submit()} disabled={!title.trim() || !dueDate || !rangeId} className="btn-primary w-full">Create assignment</button>
      </div>
    </BottomSheet>
  );
}

function NewRecurringSeriesSheet({ open, onClose, groupId, defaultRangeId }: { open: boolean; onClose: () => void; groupId: string; defaultRangeId?: string }) {
  const { ranges } = useRanges();
  const { createSeries } = useTaskGroup(groupId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('Patrol');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [recurrenceType, setRecurrenceType] = useState<TaskSeriesRecurrence>('weekly');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [intervalDays, setIntervalDays] = useState('14');
  const [startDate, setStartDate] = useState('');
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
        title: title.trim(), category, priority,
        recurrenceType,
        recurrenceRule:
          recurrenceType === 'weekly' || recurrenceType === 'weekdays' ? { weekdays } :
          recurrenceType === 'monthly' ? { dayOfMonth: Number(dayOfMonth) || 1 } :
          recurrenceType === 'custom_interval' ? { intervalDays: Number(intervalDays) || 1 } : {},
        startDate, creationTime, dueOffsetDays: Number(dueOffsetDays) || 0, rangeId,
      });
      setTitle(''); setStartDate('');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the recurring series.'));
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="New recurring task">
      <div className="p-4 space-y-3">
        {error && <p className="text-13 text-signal-red">{error}</p>}
        <div>
          <label className="block text-13 font-medium text-n-90 mb-1.5">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" style={{ fontSize: '16px' }} placeholder="Weekly fire-line inspection" />
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
              <button key={d} type="button" onClick={() => toggleWeekday(d)} className={`w-10 h-9 rounded text-13 font-medium ${weekdays.includes(d) ? 'bg-ptr-green text-white' : 'bg-n-20 text-n-80'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {recurrenceType === 'monthly' && (
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Day of month</label>
            <input type="number" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
          </div>
        )}
        {recurrenceType === 'custom_interval' && (
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Repeat every N days</label>
            <input type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Creates at (IST)</label>
            <input type="time" value={creationTime} onChange={(e) => setCreationTime(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-13 font-medium text-n-90 mb-1.5">Due after (days)</label>
            <input type="number" min="0" value={dueOffsetDays} onChange={(e) => setDueOffsetDays(e.target.value)} className="input-field" style={{ fontSize: '16px' }} />
          </div>
          <div>
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
        <p className="text-13 text-n-70">Created as a draft — activate it from the Assignments tab once ready.</p>
        <button onClick={() => void submit()} disabled={!valid} className="btn-primary w-full">Save as draft</button>
      </div>
    </BottomSheet>
  );
}

export default function MobileTaskGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const {
    group, members, occurrences, series, seriesStats, conversationId, isLoading,
    addMember, removeMember, setCoordinator, setSeriesStatus, setGroupStatus, deleteGroup,
  } = useTaskGroup(id);
  const { messages, postMessage, setPinned, redactMessage } = useGroupMessages(conversationId);
  const { users } = useUsers();
  const [tab, setTab] = useState('overview');
  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);
  const [seriesSheetOpen, setSeriesSheetOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [groupActionsOpen, setGroupActionsOpen] = useState(false);
  const [addMemberId, setAddMemberId] = useState('');

  const canManage = canManageTaskGroups(currentUser?.role);
  const isCoordinator = members.some((m) => m.userId === currentUser?.id && m.membershipRole === 'coordinator');
  const canModerate = canManage || isCoordinator;
  const memberIds = new Set(members.map((m) => m.userId));
  const addableUsers = users.filter((u) => isFieldRole(u.role) && !memberIds.has(u.id));
  const memberName = (uid: string) => users.find((u) => u.id === uid)?.name ?? '—';

  if (isLoading) return <div className="p-4"><div className="skeleton h-40" /></div>;
  if (!group) return <div className="p-6 text-center text-13 text-n-70">Group not found, or you don't have access to it.</div>;

  return (
    <div>
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-n-100 truncate">{group.name}</h1>
          <p className="text-13 text-n-70 mt-0.5">{group.groupType === 'permanent' ? 'Permanent' : 'Temporary'}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setSeriesSheetOpen(true)} className="w-11 h-11 flex items-center justify-center rounded-full border border-n-40 text-n-80" aria-label="New recurring task">
              <Repeat className="w-4.5 h-4.5" />
            </button>
            <button onClick={() => setAssignmentSheetOpen(true)} className="w-11 h-11 flex items-center justify-center rounded-full bg-ptr-green text-white" aria-label="New assignment">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => setGroupActionsOpen(true)} className="w-11 h-11 flex items-center justify-center rounded-full text-n-70" aria-label="Group actions">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      <div className="px-4">
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
      </div>

      <div className="p-4">
        {tab === 'overview' && (
          <div className="space-y-3">
            {group.description && <p className="text-13 text-n-90">{group.description}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white border border-n-30 rounded-lg p-2.5"><div className="text-xl font-semibold text-n-100">{members.length}</div><div className="text-13 text-n-80 mt-0.5">Members</div></div>
              <div className="bg-white border border-n-30 rounded-lg p-2.5"><div className="text-xl font-semibold text-n-100">{occurrences.filter((o) => o.status === 'scheduled' || o.status === 'active').length}</div><div className="text-13 text-n-80 mt-0.5">Active assignments</div></div>
            </div>
            {Object.keys(seriesStats).length > 0 && (
              <div>
                <div className="text-13 font-semibold text-n-90 mb-2">Series performance</div>
                <div className="bg-white divide-y divide-n-20 -mx-4">
                  {series.filter((s) => seriesStats[s.id]).map((s) => {
                    const stats = seriesStats[s.id];
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="text-[15px] font-medium text-n-100 truncate">{s.title}</div>
                          <div className="text-13 text-n-70">{stats.total} generated · {stats.completed} done</div>
                        </div>
                        <div className="text-lg font-semibold text-ptr-green flex-shrink-0">{stats.completionRate}%</div>
                      </div>
                    );
                  })}
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
                <div className="bg-white divide-y divide-n-20 -mx-4">
                  {series.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-n-100 truncate">{s.title}</div>
                        <div className="text-13 text-n-70"><RecurrenceSummary series={s} /></div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={`text-xs font-medium px-2 h-6 rounded-full flex items-center ${SERIES_STATUS_TONE[s.status]}`}>{SERIES_STATUS_LABEL[s.status]}</span>
                        {canManage && (s.status === 'draft' || s.status === 'paused') && (
                          <button onClick={() => setSeriesStatus.mutate({ seriesId: s.id, status: 'active' })} className="w-8 h-8 flex items-center justify-center rounded-full text-n-70 active:bg-n-10" aria-label="Activate"><Play className="w-4 h-4" /></button>
                        )}
                        {canManage && s.status === 'active' && (
                          <button onClick={() => setSeriesStatus.mutate({ seriesId: s.id, status: 'paused' })} className="w-8 h-8 flex items-center justify-center rounded-full text-n-70 active:bg-n-10" aria-label="Pause"><Pause className="w-4 h-4" /></button>
                        )}
                        {canManage && (s.status === 'active' || s.status === 'paused') && (
                          <button onClick={() => { if (confirm(`End "${s.title}"?`)) setSeriesStatus.mutate({ seriesId: s.id, status: 'ended' }); }} className="w-8 h-8 flex items-center justify-center rounded-full text-n-70 active:bg-n-10" aria-label="End"><Square className="w-4 h-4" /></button>
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
                <p className="text-13 text-n-70">No assignments yet.</p>
              ) : (
                <div className="bg-white divide-y divide-n-20 -mx-4">
                  {occurrences.map((o) => (
                    <button key={o.id} onClick={() => navigate(`occurrences/${o.id}`)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left active:bg-n-10">
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-n-100 truncate">{o.title}</div>
                        <div className="text-13 text-n-70">Due {formatDate(o.dueAt)} · {OCCURRENCE_STATUS_LABEL[o.status]}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-n-50 flex-shrink-0" />
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
              <button onClick={() => setAddSheetOpen(true)} className="btn-secondary w-full"><Plus className="w-4 h-4" />Add member</button>
            )}
            {members.length === 0 ? (
              <p className="text-13 text-n-70 text-center py-6">No members yet.</p>
            ) : (
              <div className="bg-white divide-y divide-n-20 -mx-4">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[15px] font-medium text-n-100 truncate">{memberName(m.userId)}</span>
                      {m.membershipRole === 'coordinator' && <Shield className="w-3.5 h-3.5 text-ptr-accent flex-shrink-0" />}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => setCoordinator.mutate({ memberRowId: m.id, isCoordinator: m.membershipRole !== 'coordinator' })}
                          className={`w-9 h-9 flex items-center justify-center rounded-full active:bg-n-10 ${m.membershipRole === 'coordinator' ? 'text-ptr-accent' : 'text-n-70'}`}
                          aria-label={m.membershipRole === 'coordinator' ? 'Remove as coordinator' : 'Make coordinator'}
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                        <button onClick={() => { if (confirm(`Remove ${memberName(m.userId)}?`)) removeMember.mutate(m.id); }} className="w-9 h-9 flex items-center justify-center rounded-full text-n-70 active:bg-n-10" aria-label="Remove member">
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
        )}
      </div>

      <NewAssignmentSheet open={assignmentSheetOpen} onClose={() => setAssignmentSheetOpen(false)} groupId={group.id} defaultRangeId={group.rangeId} />
      <NewRecurringSeriesSheet open={seriesSheetOpen} onClose={() => setSeriesSheetOpen(false)} groupId={group.id} defaultRangeId={group.rangeId} />

      <BottomSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} title="Add member">
        <div className="p-4 space-y-3">
          <Select value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)} className="input-field select-field">
            <option value="">Select a person</option>
            {addableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <button
            onClick={() => { if (addMemberId) { addMember.mutate(addMemberId); setAddMemberId(''); setAddSheetOpen(false); } }}
            disabled={!addMemberId}
            className="btn-primary w-full"
          >
            Add to group
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={groupActionsOpen} onClose={() => setGroupActionsOpen(false)} title="Group actions">
        <div className="p-2 space-y-1">
          {group.status === 'active' && (
            <button
              onClick={() => { setGroupActionsOpen(false); setGroupStatus.mutate('paused'); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-14 text-n-90 active:bg-n-10"
            >
              <Pause className="w-4.5 h-4.5 text-n-70" /> Pause group
            </button>
          )}
          {group.status === 'paused' && (
            <button
              onClick={() => { setGroupActionsOpen(false); setGroupStatus.mutate('active'); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-14 text-n-90 active:bg-n-10"
            >
              <Play className="w-4.5 h-4.5 text-n-70" /> Resume group
            </button>
          )}
          {group.status !== 'archived' ? (
            <button
              onClick={() => {
                setGroupActionsOpen(false);
                if (confirm(`Archive "${group.name}"? No new assignments can be created until it's unarchived — existing tasks, messages, and history stay exactly as they are.`)) {
                  setGroupStatus.mutate('archived');
                }
              }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-14 text-n-90 active:bg-n-10"
            >
              <Archive className="w-4.5 h-4.5 text-n-70" /> Archive group
            </button>
          ) : (
            <button
              onClick={() => { setGroupActionsOpen(false); setGroupStatus.mutate('active'); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-14 text-n-90 active:bg-n-10"
            >
              <ArchiveRestore className="w-4.5 h-4.5 text-n-70" /> Unarchive group
            </button>
          )}
          {currentUser?.role === 'director' && (
            <>
              <div className="h-px bg-n-30 my-1" />
              <button
                onClick={() => {
                  setGroupActionsOpen(false);
                  if (confirm(`Permanently delete "${group.name}"? Its members, series, assignments, and discussions will all be deleted. Tasks it already created will NOT be deleted — they'll just no longer be linked to a group. This cannot be undone.`)) {
                    const groupsListPath = window.location.pathname.split('/groups')[0] + '/groups';
                    deleteGroup.mutate(undefined, { onSuccess: () => navigate(groupsListPath) });
                  }
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-14 text-red-600 active:bg-red-50"
              >
                <Trash2 className="w-4.5 h-4.5" /> Delete permanently
              </button>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
