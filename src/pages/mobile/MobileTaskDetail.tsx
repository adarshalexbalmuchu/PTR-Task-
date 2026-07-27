import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Calendar, User, Tag, Navigation, Send, CheckCircle2,
  RotateCcw, Archive, AlertCircle, Paperclip, Check, RefreshCw, X, Copy,
  Edit2, Trash2, Users,
} from 'lucide-react';
import type { useTask } from '../../hooks/useTask';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import CommentThread from '../../components/CommentThread';
import BottomSheet from '../../components/mobile/BottomSheet';
import EvidenceCapture, { EMPTY_EVIDENCE, type CapturedEvidence } from '../../components/mobile/EvidenceCapture';
import { isOverdue } from '../../utils/overdue';
import { formatDate, formatDateTime, formatDueRelative, formatFileSize } from '../../utils/formatters';
import { isFieldRole } from '../../types';
import { canManageTasks } from '../../lib/permissions';
import { getErrorMessage } from '../../lib/errors';
import type { Task, User as UserT, Range, Area } from '../../types';

type QueuedStatus = 'uploading' | 'uploaded' | 'failed';
interface QueuedItem { id: string; name: string; file: File; status: QueuedStatus; }

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="text-n-60 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-n-70">{label}</div>
        <div className="text-[15px] text-n-100 mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

// `task` is guaranteed non-null here — TaskDetailPage only mounts this after
// its own loading/not-found checks pass, and passes down the exact same
// useTask() instance/mutations it already holds (no second subscription).
type UseTaskResult = ReturnType<typeof useTask>;
interface Props {
  task: Task;
  currentUser: UserT | null;
  users: UserT[];
  ranges: Range[];
  areas: Area[];
  startTask: UseTaskResult['startTask'];
  completeTask: UseTaskResult['completeTask'];
  archiveTask: UseTaskResult['archiveTask'];
  reopenTask: UseTaskResult['reopenTask'];
  requestChanges: UseTaskResult['requestChanges'];
  addComment: UseTaskResult['addComment'];
  addTaskUpdate: UseTaskResult['addTaskUpdate'];
  uploadAttachment: UseTaskResult['uploadAttachment'];
  onEdit: () => void;
  onDelete: () => void;
  groupLink: { name: string; path: string } | null;
}

export default function MobileTaskDetail({
  task, currentUser, users, ranges, areas,
  startTask, completeTask, archiveTask, reopenTask, requestChanges,
  addComment, addTaskUpdate, uploadAttachment,
  onEdit, onDelete, groupLink,
}: Props) {
  const navigate = useNavigate();

  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidence, setEvidence] = useState<CapturedEvidence>(EMPTY_EVIDENCE);
  const [progressPct, setProgressPct] = useState(0);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState('');
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const commentsRef = useRef<HTMLDivElement>(null);

  const role = currentUser?.role;
  const canManage = canManageTasks(role);
  const isAssignee = !!currentUser && (task.assigneeId === currentUser.id || task.coAssigneeIds.includes(currentUser.id));
  const assignee = users.find((u) => u.id === task.assigneeId);
  const coAssignees = task.coAssigneeIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
  const range = ranges.find((r) => r.id === task.rangeId);
  const area = areas.find((a) => a.id === task.areaId);
  const overdue = isOverdue(task);
  const due = formatDueRelative(task.dueDate, task.status === 'Completed' || task.status === 'Archived');
  const lastComment = task.comments[task.comments.length - 1];
  const changesRequested = task.status === 'InProgress' && lastComment?.content.startsWith('[Changes Requested]');
  const latestGps = task.taskUpdates.filter((u) => u.lat !== undefined && u.lng !== undefined).slice(-1)[0];

  const assigneeCanAct = isAssignee && isFieldRole(role) && (task.status === 'NotStarted' || task.status === 'InProgress');
  const managerCanAct = canManage && (task.status === 'Completed' || task.status === 'Archived');
  const noActionMessage =
    !assigneeCanAct && !managerCanAct
      ? task.status === 'Completed' && isAssignee
        ? 'Submitted — waiting for review.'
        : canManage && task.status === 'InProgress'
        ? "In progress — no action needed from you yet."
        : canManage && task.status === 'NotStarted'
        ? 'Waiting for the assignee to accept this task.'
        : "You're viewing this task read-only."
      : null;

  const uploadEvidence = async () => {
    const files = [...evidence.photos, ...evidence.videos, ...(evidence.audio ? [evidence.audio] : [])];
    const items: QueuedItem[] = files.map((f) => ({ id: crypto.randomUUID(), name: f.name, file: f, status: 'uploading' }));
    setQueue((q) => [...items, ...q]);
    for (const item of items) {
      try {
        await uploadAttachment.mutateAsync(item.file);
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'uploaded' } : x)));
      } catch {
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'failed' } : x)));
      }
    }
    if (evidence.note.trim() || evidence.gps || files.length > 0) {
      await addTaskUpdate.mutateAsync({ note: evidence.note.trim() || 'Field evidence attached', progressPercentage: progressPct });
    }
    setEvidence(EMPTY_EVIDENCE);
    setEvidenceOpen(false);
  };

  const retryUpload = async (item: QueuedItem) => {
    setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'uploading' } : x)));
    try {
      await uploadAttachment.mutateAsync(item.file);
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'uploaded' } : x)));
    } catch {
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'failed' } : x)));
    }
  };

  const scrollToComments = () => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Every lifecycle action reports what actually happened — the mutations
  // already verify affected rows (see useTask.ts), so a thrown error here
  // means the database genuinely didn't change, not just a network blip.
  const runLifecycle = async (mutate: () => Promise<unknown>, failureFallback: string) => {
    try {
      await mutate();
    } catch (err) {
      alert(getErrorMessage(err, failureFallback));
    }
  };
  const anyLifecycleBusy = startTask.isPending || completeTask.isPending || archiveTask.isPending || reopenTask.isPending || requestChanges.isPending;

  const copyTaskId = () => {
    void navigator.clipboard?.writeText(task.id).catch(() => {});
  };

  // Rendered inside MobileShell's <main> (the app's single scroll owner) —
  // no h-[calc(...)] / overflow-y-auto here, or this page would create a
  // second, nested scrollbar. The sub-header and action bar use `sticky`
  // instead of their own flex-shrink-0 rows in an independent flex column,
  // so they still pin to the top/bottom of the shared scrollport.
  return (
    <div>
      {/* Sub-header */}
      <div className="sticky top-0 z-10 bg-white flex items-center gap-2 px-2 h-14 border-b border-n-30">
        <button onClick={() => navigate(-1)} className="w-11 h-11 flex items-center justify-center rounded-full text-n-90 active:bg-n-20" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="text-13 text-n-90 font-mono">Task #{task.id.slice(0, 8).toUpperCase()}</span>
          <button onClick={copyTaskId} className="w-7 h-7 flex items-center justify-center rounded text-n-70 active:bg-n-20 flex-shrink-0" aria-label="Copy task ID">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        {canManage && (
          <div className="flex items-center flex-shrink-0">
            <button onClick={onEdit} className="w-10 h-10 flex items-center justify-center rounded-full text-n-80 active:bg-n-20" aria-label="Edit task">
              <Edit2 className="w-4.5 h-4.5" />
            </button>
            <button onClick={onDelete} className="w-10 h-10 flex items-center justify-center rounded-full text-signal-red active:bg-signal-red-bg" aria-label="Delete task">
              <Trash2 className="w-4.5 h-4.5" />
            </button>
          </div>
        )}
      </div>

      <div className="pb-4">
        <div className="px-4 pt-4">
          <h1 className="text-xl font-semibold text-n-100 leading-snug">{task.title}</h1>
          <div className="flex items-center flex-wrap gap-3 mt-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          {overdue && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-13 font-semibold text-signal-red">
              <span className="w-2 h-2 rounded-full bg-signal-red" />{due.text || 'Overdue'}
            </div>
          )}
          {groupLink && (
            <button
              onClick={() => navigate(groupLink.path)}
              className="mt-2 inline-flex items-center gap-1.5 text-13 font-medium text-ptr-accent bg-ptr-accent/10 active:bg-ptr-accent/20 rounded-full px-2.5 h-7"
            >
              <Users className="w-3.5 h-3.5" />Part of {groupLink.name}
            </button>
          )}
        </div>

        {changesRequested && (
          <div className="mx-4 mt-3 rounded border border-signal-amber/40 bg-signal-amber/10 p-3">
            <div className="flex items-center gap-1.5 text-13 font-semibold text-signal-amber"><AlertCircle className="w-4 h-4" />Changes requested</div>
            <p className="text-13 text-n-90 mt-1">{lastComment.content.replace('[Changes Requested] ', '')}</p>
            <button onClick={scrollToComments} className="text-13 font-medium text-ptr-accent mt-1.5">View full feedback →</button>
          </div>
        )}

        {task.status === 'Completed' && isAssignee && (
          <div className="mx-4 mt-3 rounded bg-n-10 p-3 text-13 text-n-80 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-signal-green flex-shrink-0" />Submitted — awaiting review
          </div>
        )}

        {/* Meta */}
        <div className="px-4 mt-2 divide-y divide-n-20">
          <MetaRow icon={<User className="w-4 h-4" />} label={coAssignees.length ? 'Assignees' : 'Assignee'} value={[assignee?.name ?? '—', ...coAssignees].join(', ')} />
          <MetaRow icon={<Calendar className="w-4 h-4" />} label="Due date" value={<span className={due.tone === 'overdue' ? 'text-signal-red font-medium' : due.tone === 'soon' ? 'text-signal-amber font-medium' : ''}>{formatDate(task.dueDate)}{due.text ? ` · ${due.text}` : ''}</span>} />
          <MetaRow icon={<MapPin className="w-4 h-4" />} label="Range / beat" value={area ? `${range?.name ?? '—'} · ${area.name}` : range?.name ?? '—'} />
          <MetaRow icon={<Tag className="w-4 h-4" />} label="Category" value={task.category === 'Other' && task.categoryOther ? task.categoryOther : task.category} />
          {latestGps && (
            <MetaRow
              icon={<Navigation className="w-4 h-4" />}
              label="Last field location"
              value={
                <a href={`https://www.google.com/maps?q=${latestGps.lat},${latestGps.lng}`} target="_blank" rel="noopener noreferrer" className="text-ptr-accent font-medium">
                  {latestGps.lat!.toFixed(5)}, {latestGps.lng!.toFixed(5)}
                </a>
              }
            />
          )}
        </div>

        {task.description && (
          <div className="px-4 mt-3">
            <div className="text-xs font-semibold text-n-70 uppercase tracking-wide mb-1.5">Description</div>
            <p className="text-[15px] text-n-90 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        {/* Evidence / attachments */}
        <div className="px-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-n-70 uppercase tracking-wide">Evidence ({task.attachments.length})</div>
            {(isAssignee || canManage) && (
              <button onClick={() => setEvidenceOpen(true)} className="text-13 font-medium text-ptr-accent flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />Add</button>
            )}
          </div>
          {queue.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {queue.map((item) => (
                <div key={item.id} className="flex items-center gap-2 bg-n-10 rounded px-3 py-2 text-13">
                  <span className="flex-1 min-w-0 truncate text-n-90">{item.name}</span>
                  {item.status === 'uploading' && <span className="flex items-center gap-1 text-n-70 flex-shrink-0"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Uploading</span>}
                  {item.status === 'uploaded' && <span className="flex items-center gap-1 text-signal-green flex-shrink-0"><Check className="w-3.5 h-3.5" />Uploaded</span>}
                  {item.status === 'failed' && (
                    <button onClick={() => retryUpload(item)} className="flex items-center gap-1 text-signal-red font-medium flex-shrink-0">
                      <X className="w-3.5 h-3.5" />Failed · Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {task.attachments.length === 0 && queue.length === 0 ? (
            <p className="text-13 text-n-70 italic">No evidence attached yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {task.attachments.map((att) => (
                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-n-10 border border-n-30 rounded px-2.5 py-2 max-w-[180px]">
                  {att.previewUrl ? <img src={att.previewUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" /> : <Paperclip className="w-4 h-4 text-n-70 flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-n-90 truncate">{att.name}</div>
                    <div className="text-[11px] text-n-70">{formatFileSize(att.size)}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Activity history */}
        {task.taskUpdates.length > 0 && (
          <div className="px-4 mt-4">
            <div className="text-xs font-semibold text-n-70 uppercase tracking-wide mb-2">Activity history</div>
            <div className="space-y-2.5">
              {[...task.taskUpdates].reverse().map((upd) => {
                const author = users.find((u) => u.id === upd.userId);
                return (
                  <div key={upd.id} className="bg-n-10 rounded p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-13 font-semibold text-n-90">{author?.name ?? 'Unknown'}</span>
                      <span className="text-xs text-n-80">{upd.progressPercentage}% · {formatDateTime(upd.createdAt)}</span>
                    </div>
                    <p className="text-13 text-n-90 mt-0.5">{upd.note}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comments */}
        <div ref={commentsRef} className="px-4 mt-4">
          <div className="text-xs font-semibold text-n-70 uppercase tracking-wide mb-2">Comments ({task.comments.length})</div>
          {currentUser && <CommentThread comments={task.comments} users={users} currentUser={currentUser} onAddComment={(c) => addComment.mutateAsync(c)} />}
        </div>
      </div>

      {/* Sticky bottom lifecycle action bar — pins to the bottom of <main>
          (the shared scroll owner) via `sticky`, not its own fixed-height
          flex row, so the rest of the page still scrolls fully above it. */}
      <div className="sticky bottom-0 z-10 border-t border-n-30 bg-white p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {isAssignee && isFieldRole(role) && task.status === 'NotStarted' && (
          <button
            onClick={() => void runLifecycle(() => startTask.mutateAsync(), 'Could not start this task.')}
            disabled={anyLifecycleBusy}
            className="btn-primary w-full h-12 text-[15px] disabled:opacity-60"
          >
            {startTask.isPending ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {startTask.isPending ? 'Starting…' : 'Accept & start task'}
          </button>
        )}
        {isAssignee && isFieldRole(role) && task.status === 'InProgress' && (
          <div className="flex gap-2">
            {changesRequested && (
              <button onClick={scrollToComments} className="btn-secondary flex-1 h-12 text-[15px]"><AlertCircle className="w-4 h-4" />View feedback</button>
            )}
            <button onClick={() => setEvidenceOpen(true)} className="btn-secondary flex-1 h-12 text-[15px]" disabled={anyLifecycleBusy}><Paperclip className="w-4 h-4" />Add evidence</button>
            <button
              onClick={() => void runLifecycle(() => completeTask.mutateAsync(), 'Could not submit this task for review.')}
              disabled={anyLifecycleBusy}
              className="btn-primary flex-1 h-12 text-[15px] disabled:opacity-60"
            >
              {completeTask.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {completeTask.isPending ? 'Submitting…' : changesRequested ? 'Resubmit for review' : 'Submit for review'}
            </button>
          </div>
        )}
        {canManage && task.status === 'Completed' && !reviseOpen && (
          <div className="flex gap-2">
            <button onClick={() => setReviseOpen(true)} disabled={anyLifecycleBusy} className="btn-secondary flex-1 h-12 text-[15px] disabled:opacity-60"><RotateCcw className="w-4 h-4" />Request changes</button>
            <button
              onClick={() => void runLifecycle(() => archiveTask.mutateAsync(), 'Could not approve and close this task.')}
              disabled={anyLifecycleBusy}
              className="btn-primary flex-1 h-12 text-[15px] disabled:opacity-60"
            >
              {archiveTask.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              {archiveTask.isPending ? 'Closing…' : 'Approve & close'}
            </button>
          </div>
        )}
        {canManage && task.status === 'Completed' && reviseOpen && (
          <div className="space-y-2">
            <textarea value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} rows={2} placeholder="What needs to change?" className="input-field resize-none" style={{ fontSize: '16px' }} />
            <div className="flex gap-2">
              <button onClick={() => setReviseOpen(false)} disabled={requestChanges.isPending} className="btn-secondary flex-1 h-11">Cancel</button>
              <button
                onClick={() => void runLifecycle(async () => { await requestChanges.mutateAsync(reviseNote.trim()); setReviseOpen(false); setReviseNote(''); }, 'Could not send this back for changes.')}
                disabled={requestChanges.isPending}
                className="btn-primary flex-1 h-11 disabled:opacity-60"
              >
                {requestChanges.isPending ? 'Sending…' : 'Send back'}
              </button>
            </div>
          </div>
        )}
        {canManage && task.status === 'Archived' && (
          <button
            onClick={() => { if (confirm('Reopen this task for further work?')) void runLifecycle(() => reopenTask.mutateAsync(), 'Could not reopen this task.'); }}
            disabled={anyLifecycleBusy}
            className="btn-secondary w-full h-12 text-[15px] disabled:opacity-60"
          >
            {reopenTask.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {reopenTask.isPending ? 'Reopening…' : 'Reopen task'}
          </button>
        )}
        {noActionMessage && (
          <div className="text-center text-13 text-n-70 py-2">{noActionMessage}</div>
        )}
      </div>

      <BottomSheet open={evidenceOpen} onClose={() => setEvidenceOpen(false)} title="Add evidence">
        <div className="p-4 space-y-4">
          <EvidenceCapture value={evidence} onChange={setEvidence} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-n-70">Progress</span>
              <span className="text-13 font-bold text-n-100">{progressPct}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={progressPct} onChange={(e) => setProgressPct(Number(e.target.value))} className="w-full accent-ptr-green" />
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-n-30 p-3">
          <button onClick={uploadEvidence} className="btn-primary w-full h-12 text-[15px]">Save evidence</button>
        </div>
      </BottomSheet>
    </div>
  );
}
