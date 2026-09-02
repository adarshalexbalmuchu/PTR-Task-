import { useState, useEffect, useMemo, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Plus, X, MapPin, Trash2, Camera, ImagePlus, FolderOpen, ClipboardPlus, Search,
  Filter, RefreshCw, Download, MoreHorizontal, ChevronDown, UserCog, CircleDashed, CheckCircle2, RotateCcw,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { useIncidents } from '../../hooks/useIncidents';
import { useRanges } from '../../hooks/useRanges';
import { useOfficerRanges } from '../../hooks/useOfficerRanges';
import { useTasks } from '../../hooks/useTasks';
import { useUsers } from '../../hooks/useUsers';
import PriorityBadge from '../../components/PriorityBadge';
import EmptyState from '../../components/EmptyState';
import Select from '../../components/Select';
import TaskForm from '../../components/TaskForm';
import { Menu, MenuItem, MenuLabel, MenuDivider } from '../../components/ui/Menu';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { PanelSection, PanelItem } from '../../components/layout/PanelNav';
import { Page, PageHeading } from '../../components/layout/Page';
import { usePanelToggle } from '../../contexts/PanelToggleContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import MobileIncidentList from '../mobile/MobileIncidentList';
import { formatDate, formatDateTime } from '../../utils/formatters';
import { exportCsv } from '../../utils/exportCsv';
import { describeBulkOutcome } from '../../lib/mutationVerification';
import { canManageIncidents } from '../../lib/permissions';
import { uploadTaskAttachment } from '../../lib/attachments';
import { MAX_INCIDENT_PHOTOS } from '../../lib/incidentPhotos';
import { INCIDENT_CATEGORIES, formatIncidentType, isOtherIncidentType, isHighSeverity } from '../../lib/incidentTypes';
import { getErrorMessage } from '../../lib/errors';
import type { IncidentType, IncidentSeverity, Incident, TaskPriority } from '../../types';
import { isFieldRole } from '../../types';

// Incidents don't carry a task priority — map the reporter's severity call
// onto the nearest task priority so a follow-up task opens pre-triaged.
const SEVERITY_TO_PRIORITY: Record<IncidentSeverity, TaskPriority> = {
  Low: 'Low', Medium: 'Medium', High: 'High', Critical: 'Critical',
};

const SEVERITIES: IncidentSeverity[] = ['Low', 'Medium', 'High', 'Critical'];

function ReportForm({
  isOpen,
  onClose,
  defaultRangeId,
  lockRange,
  allowedRangeIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultRangeId: string;
  lockRange: boolean;
  /** When set, the range picker only offers these ranges (a multi-range
      officer reports within their own ranges; directors see all). */
  allowedRangeIds?: string[];
}) {
  const { ranges, areas } = useRanges();
  const selectableRanges = allowedRangeIds?.length
    ? ranges.filter((r) => allowedRangeIds.includes(r.id))
    : ranges;
  const { reportIncident } = useIncidents();

  const [type, setType] = useState<IncidentType>('wildlife_sighting');
  const [typeOther, setTypeOther] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('Medium');
  const [description, setDescription] = useState('');
  const [rangeId, setRangeId] = useState(defaultRangeId);
  const [areaId, setAreaId] = useState('');
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [locationBlocked, setLocationBlocked] = useState(false);

  const isOther = isOtherIncidentType(type);

  // Browsers never re-prompt for geolocation once a user has denied it —
  // getCurrentPosition() would then just silently fail on every future
  // report. Check the permission state up front so we can tell the reporter
  // *why* GPS won't attach and that it needs a settings change, not a retry.
  useEffect(() => {
    if (!isOpen || !('permissions' in navigator)) return;
    let cancelled = false;
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setLocationBlocked(status.state === 'denied');
        status.onchange = () => setLocationBlocked(status.state === 'denied');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen]);

  // Recomputed only when the file list itself changes (not on every
  // keystroke elsewhere in the form), and revoked on cleanup so preview
  // blobs don't pile up while the modal is open.
  const photoPreviews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => {
    return () => photoPreviews.forEach((url) => URL.revokeObjectURL(url));
  }, [photoPreviews]);

  const filteredAreas = areas.filter((a) => a.rangeId === rangeId);

  if (!isOpen) return null;

  const addPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const picked = Array.from(e.target.files);
      // The "Files" picker can reach any document in storage, so reject
      // anything that isn't an image before it hits the JPEG compression
      // pipeline (some file managers report an empty MIME type, so fall
      // back to matching the extension).
      const isImage = (f: File) =>
        f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(f.name);
      const incoming = picked.filter(isImage);
      if (incoming.length < picked.length) {
        setError('Only image files can be attached to a report.');
      }
      if (incoming.length > 0) {
        setPhotos((prev) => [...prev, ...incoming].slice(0, MAX_INCIDENT_PHOTOS));
      }
      e.target.value = '';
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim()) { setError('Description is required'); return; }
    if (!rangeId) { setError('Please select a range'); return; }
    if (isOther && !typeOther.trim()) { setError('Please specify the type'); return; }
    reportIncident.mutate(
      {
        type,
        typeOther: isOther ? typeOther.trim() : undefined,
        severity,
        description: description.trim(),
        rangeId,
        areaId: areaId || undefined,
        files: photos,
      },
      {
        onSuccess: () => {
          setDescription('');
          setAreaId('');
          setSeverity('Medium');
          setType('wildlife_sighting');
          setTypeOther('');
          setPhotos([]);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-ptr-cream-dark">
          <h2 className="text-lg font-semibold text-ptr-brown">Report Incident</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ptr-cream transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-ptr-brown-light" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Type</label>
            <Select
              value={type}
              onChange={(e) => { setType(e.target.value as IncidentType); setTypeOther(''); setError(''); }}
              className="input-field select-field"
            >
              {INCIDENT_CATEGORIES.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.options.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
          {isOther && (
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">
                Specify type <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={typeOther}
                onChange={(e) => { setTypeOther(e.target.value); setError(''); }}
                placeholder="e.g. Snake bite, Fence damage"
                maxLength={100}
                className="input-field"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Severity</label>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} className="input-field select-field">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">Range</label>
              <Select
                value={rangeId}
                onChange={(e) => { setRangeId(e.target.value); setAreaId(''); }}
                className="input-field select-field"
                disabled={lockRange}
              >
                <option value="">Select range</option>
                {selectableRanges.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ptr-brown mb-1.5">Area / Zone</label>
              <Select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="input-field select-field" disabled={!rangeId}>
                <option value="">Unspecified</option>
                {filteredAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setError(''); }}
              placeholder="Describe what happened..."
              rows={4}
              maxLength={3000}
              className={`input-field resize-none ${error ? 'input-error' : ''}`}
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
          {locationBlocked ? (
            <p className="text-xs text-red-600 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              Location access is blocked for this app, so reports can't be submitted. Enable location for this site in your browser/phone settings, then reopen this form.
            </p>
          ) : (
            <p className="text-xs text-ptr-brown-light flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              GPS location is required and will be captured automatically — allow the location prompt if asked.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-ptr-brown mb-1.5">
              Photos <span className="text-ptr-brown-light font-normal">(optional, up to {MAX_INCIDENT_PHOTOS})</span>
            </label>
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {photos.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="relative w-16 h-16 rounded-xl overflow-hidden border border-ptr-cream-dark flex-shrink-0">
                    <img src={photoPreviews[i]} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < MAX_INCIDENT_PHOTOS && (
              <div className="flex flex-wrap gap-2">
                <label className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-ptr-cream-dark rounded-xl text-sm text-ptr-brown-light hover:bg-ptr-cream cursor-pointer transition-colors min-h-[44px]">
                  <Camera className="w-4 h-4" />
                  <span>Take Photo</span>
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={addPhotos} />
                </label>
                <label className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-ptr-cream-dark rounded-xl text-sm text-ptr-brown-light hover:bg-ptr-cream cursor-pointer transition-colors min-h-[44px]">
                  <ImagePlus className="w-4 h-4" />
                  <span>Gallery</span>
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={addPhotos} />
                </label>
                {/* Extension-based accept (not image/*) so the OS opens the
                    file-manager / documents picker — lets the reporter attach
                    an image saved in Downloads, Drive, WhatsApp, etc., not
                    just the photo gallery. */}
                <label className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-ptr-cream-dark rounded-xl text-sm text-ptr-brown-light hover:bg-ptr-cream cursor-pointer transition-colors min-h-[44px]">
                  <FolderOpen className="w-4 h-4" />
                  <span>Files</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.bmp,.tif,.tiff"
                    multiple
                    className="sr-only"
                    onChange={addPhotos}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-ptr-cream-dark">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={reportIncident.isPending || locationBlocked} className="btn-primary">
              {reportIncident.isPending ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IncidentLog() {
  const currentUser = useStore((s) => s.currentUser);
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const panelToggle = usePanelToggle();
  const { incidents, isLoading, deleteIncident, removePhoto, assignIncidents, changeSeverity, setStatus } = useIncidents();
  const { ranges, areas } = useRanges();
  const { createTask } = useTasks();
  const { users } = useUsers();
  const [formOpen, setFormOpen] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [followUpFor, setFollowUpFor] = useState<Incident | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';

  const { activeRangeId, rangeIds, isMultiRange } = useOfficerRanges();
  // Directors and Tiger Cell staff aren't posted to one range, so they pick
  // any range; multi-range officers pick among THEIR ranges (select stays
  // enabled, options limited below); everyone else is locked to their
  // single range.
  const hasNoFixedRange = currentUser?.role === 'director' || currentUser?.role === 'tiger_cell';
  const lockRange = !hasNoFixedRange && !isMultiRange;
  // Mirrors the incidents_director / incidents_tiger_cell RLS policies —
  // these are the only roles with any UPDATE grant on incidents at all, so
  // selection/bulk actions are gated the same way: not just hidden for
  // everyone else, but genuinely rejected by the database too.
  const canManage = canManageIncidents(currentUser?.role, currentUser?.id);
  const canCreateTask = currentUser?.role === 'director' || currentUser?.role === 'range_officer';
  const responders = users.filter((u) => isFieldRole(u.role));
  const assignableUsers = users.filter((u) => isFieldRole(u.role) && (!followUpFor || u.rangeId === followUpFor.rangeId));

  const handleDelete = (id: string) => {
    if (confirm('Delete this incident report? This cannot be undone.')) {
      deleteIncident.mutate(id);
    }
  };

  if (isMobile) {
    if (!currentUser) return null;
    return (
      <MobileIncidentList
        currentUserId={currentUser.id}
        defaultRangeId={hasNoFixedRange ? '' : activeRangeId}
        lockRange={lockRange && !!activeRangeId}
        allowedRangeIds={hasNoFixedRange ? undefined : rangeIds}
        autoOpenWizard={params.get('report') === '1'}
      />
    );
  }

  const filtered = incidents.filter((i) => {
    if (filterType && i.type !== filterType) return false;
    if (filterSeverity === 'high') { if (!isHighSeverity(i.severity)) return false; }
    else if (filterSeverity && i.severity !== filterSeverity) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!formatIncidentType(i).toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const highCount = incidents.filter((i) => isHighSeverity(i.severity)).length;
  const criticalCount = incidents.filter((i) => i.severity === 'Critical').length;

  const selectedIncidents = filtered.filter((i) => selectedIds.includes(i.id));
  const hasSel = selectedIncidents.length > 0;
  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length;
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : filtered.map((i) => i.id));
  const toggleOne = (id: string) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  // "Mark resolved" flips to "Reopen" once every selected incident is
  // already resolved, mirroring the task registry's status-aware labelling.
  const allSelectedResolved = hasSel && selectedIncidents.every((i) => i.status === 'Resolved');

  const doRefresh = () => queryClient.invalidateQueries({ queryKey: ['incidents'] });
  const toExportRows = (rows: Incident[]) => rows.map((i) => ({
    Type: formatIncidentType(i),
    Severity: i.severity,
    Status: i.status,
    Range: ranges.find((r) => r.id === i.rangeId)?.name ?? '',
    'Reported by': i.reporterName ?? '',
    'Assigned to': users.find((u) => u.id === i.assignedTo)?.name ?? '',
    Date: formatDate(i.incidentDate),
    Description: i.description,
  }));
  const doExport = () => exportCsv(`ptr-incidents-${new Date().toISOString().slice(0, 10)}.csv`, toExportRows(filtered));
  const doExportSelected = () => exportCsv(`ptr-incidents-selected-${new Date().toISOString().slice(0, 10)}.csv`, toExportRows(selectedIncidents));

  const bulkAssign = async (userId: string) => {
    const ids = selectedIds;
    setSelectedIds([]);
    try {
      const result = await assignIncidents.mutateAsync({ ids, userId });
      alert(describeBulkOutcome(result, ids.length, 'incidents'));
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to assign the selected incidents.'));
    }
  };
  const bulkSeverity = async (severity: IncidentSeverity) => {
    const ids = selectedIds;
    setSelectedIds([]);
    try {
      const result = await changeSeverity.mutateAsync({ ids, severity });
      alert(describeBulkOutcome(result, ids.length, 'incidents'));
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to update severity for the selected incidents.'));
    }
  };
  const bulkToggleResolved = async () => {
    const ids = selectedIds;
    const nextStatus = allSelectedResolved ? 'Open' : 'Resolved';
    const verb = nextStatus === 'Resolved' ? 'resolve' : 'reopen';
    if (!confirm(`Mark ${ids.length} selected incident${ids.length > 1 ? 's' : ''} as ${nextStatus.toLowerCase()}?`)) return;
    setSelectedIds([]);
    try {
      const result = await setStatus.mutateAsync({ ids, status: nextStatus });
      alert(describeBulkOutcome(result, ids.length, 'incidents'));
    } catch (err) {
      alert(getErrorMessage(err, `Failed to ${verb} the selected incidents.`));
    }
  };

  return (
    <>
      <CommandBar>
        {canManage && hasSel ? (
          <>
            <span className="text-13 font-semibold text-n-90 whitespace-nowrap">{selectedIds.length} selected</span>
            <span className="w-px h-5 bg-n-30 mx-1" />

            <Menu ariaLabel="Assign response" button={<><UserCog className="w-4 h-4" />Assign response<ChevronDown className="w-3.5 h-3.5 opacity-60" /></>}>
              <MenuLabel>Assign {selectedIncidents.length} incident{selectedIncidents.length > 1 ? 's' : ''} to</MenuLabel>
              {responders.map((u) => <MenuItem key={u.id} label={u.name} onClick={() => bulkAssign(u.id)} />)}
            </Menu>

            <Menu ariaLabel="Change severity of selected" button={<><CircleDashed className="w-4 h-4" />Severity<ChevronDown className="w-3.5 h-3.5 opacity-60" /></>}>
              <MenuLabel>Set severity</MenuLabel>
              {SEVERITIES.map((s) => <MenuItem key={s} label={s} onClick={() => bulkSeverity(s)} />)}
            </Menu>

            <button onClick={bulkToggleResolved} className="btn-subtle">
              {allSelectedResolved ? <RotateCcw className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {allSelectedResolved ? 'Reopen' : 'Mark resolved'}
            </button>

            <button onClick={() => setSelectedIds([])} className="btn-subtle">Clear selection</button>

            <Menu ariaLabel="More actions" align="right" button={<MoreHorizontal className="w-4 h-4" />}>
              <MenuItem icon={<Download className="w-4 h-4" />} label="Export selected" onClick={doExportSelected} />
              <MenuItem icon={<Download className="w-4 h-4" />} label="Export all filtered" onClick={doExport} />
              <MenuDivider />
              <MenuItem icon={<Trash2 className="w-4 h-4" />} label={`Delete ${selectedIncidents.length} selected`} danger onClick={() => {
                if (confirm(`Delete ${selectedIncidents.length} selected incident${selectedIncidents.length > 1 ? 's' : ''}? This cannot be undone.`)) {
                  selectedIncidents.forEach((i) => deleteIncident.mutate(i.id));
                  setSelectedIds([]);
                }
              }} />
            </Menu>
          </>
        ) : (
          <>
            <button onClick={() => setFormOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />New incident</button>
            <button onClick={() => panelToggle?.toggle()} className="btn-subtle"><Filter className="w-4 h-4" />Filter</button>
            <button onClick={doRefresh} className="btn-subtle"><RefreshCw className="w-4 h-4" />Refresh</button>
            <button onClick={doExport} className="btn-subtle"><Download className="w-4 h-4" />Export</button>
            {canManage && (
              <Menu ariaLabel="More actions" align="right" button={<MoreHorizontal className="w-4 h-4" />}>
                <MenuItem
                  icon={<UserCog className="w-4 h-4" />}
                  label="Assign response"
                  disabled
                  title="Select one or more incidents to assign them."
                  onClick={() => {}}
                />
              </Menu>
            )}
          </>
        )}
      </CommandBar>

      <ContextPanel>
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-n-70" />
            <input
              value={search}
              onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); e.target.value ? n.set('q', e.target.value) : n.delete('q'); return n; }, { replace: true })}
              placeholder="Filter these results…"
              className="input-field pl-8 !min-h-[34px] text-13"
              style={{ fontSize: '16px' }}
            />
          </div>
        </div>
        <PanelSection label="Views">
          <PanelItem label="All incidents" active={!filterSeverity && !filterType} count={incidents.length} onClick={() => { setFilterSeverity(''); setFilterType(''); }} />
          <PanelItem label="High severity" active={filterSeverity === 'high'} count={highCount} countTone="amber" onClick={() => setFilterSeverity('high')} />
          <PanelItem label="Critical" active={filterSeverity === 'Critical'} count={criticalCount} countTone="red" onClick={() => setFilterSeverity('Critical')} />
        </PanelSection>
        <PanelSection label="Severity">
          {SEVERITIES.map((s) => (
            <PanelItem key={s} label={s} active={filterSeverity === s} count={incidents.filter((i) => i.severity === s).length} onClick={() => setFilterSeverity(s)} />
          ))}
        </PanelSection>
        <div className="px-1">
          <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-n-70">Type</div>
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input-field select-field !min-h-[34px] text-13">
            <option value="">All types</option>
            {INCIDENT_CATEGORIES.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.options.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </div>
      </ContextPanel>

      <Page className="space-y-4">
        <PageHeading title="Incident reports" meta="Human–wildlife conflict & field observations" />

      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="No incidents reported"
          description="Report a human-wildlife conflict or field observation to get started."
        />
      ) : (
        <div className="card divide-y divide-n-20 overflow-hidden">
          {canManage && (
            <label className="flex items-center gap-2.5 px-4 h-10 bg-n-10 text-13 text-n-80 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = hasSel && !allSelected; }}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 accent-ptr-green cursor-pointer"
                aria-label="Select all incidents"
              />
              Select all {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
            </label>
          )}
          {filtered.map((incident) => {
            const range = ranges.find((r) => r.id === incident.rangeId);
            const area = areas.find((a) => a.id === incident.areaId);
            const assignee = users.find((u) => u.id === incident.assignedTo);
            const selected = selectedIds.includes(incident.id);
            return (
              <div key={incident.id} className={`p-4 space-y-2 transition-colors ${selected ? 'bg-ptr-accent/[0.07]' : ''}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {canManage && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOne(incident.id)}
                        className="w-3.5 h-3.5 accent-ptr-green cursor-pointer mr-0.5"
                        aria-label={`Select incident: ${formatIncidentType(incident)}`}
                      />
                    )}
                    <span className="text-sm font-semibold text-ptr-brown">{formatIncidentType(incident)}</span>
                    <PriorityBadge priority={incident.severity} size="sm" />
                    <span className={`text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${incident.status === 'Resolved' ? 'bg-n-20 text-n-70' : 'bg-signal-amber/10 text-signal-amber'}`}>
                      {incident.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-ptr-brown-light">{formatDateTime(incident.incidentDate)}</span>
                    {canCreateTask && (
                      <button
                        onClick={() => setFollowUpFor(incident)}
                        className="p-1 rounded-lg hover:bg-n-20 text-ptr-brown-light hover:text-ptr-brown transition-colors"
                        title="Create follow-up task"
                        aria-label="Create follow-up task"
                      >
                        <ClipboardPlus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canManage && (
                      <button
                        onClick={() => handleDelete(incident.id)}
                        className="p-1 rounded-lg hover:bg-red-50 text-ptr-brown-light hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-ptr-brown">{incident.description}</p>
                {incident.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {incident.photos.map((photo) => (
                      <div key={photo.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-ptr-cream-dark flex-shrink-0 group">
                        <a href={photo.url} target="_blank" rel="noopener noreferrer">
                          <img src={photo.url} alt="" className="w-full h-full object-cover" />
                        </a>
                        {canManage && (
                          <button
                            onClick={() => { if (confirm('Remove this photo?')) removePhoto.mutate(photo.id); }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white items-center justify-center hover:bg-red-600 transition-colors hidden group-hover:flex"
                            aria-label="Remove photo"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap text-xs text-ptr-brown-light">
                  <span>Reported by {incident.reporterName ?? 'Unknown'}</span>
                  <span>·</span>
                  <span>{range?.name ?? '—'}</span>
                  {area && <><span>·</span><span>{area.name}</span></>}
                  {assignee && <><span>·</span><span>Assigned to {assignee.name}</span></>}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ptr-brown-light">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {incident.lat !== undefined && incident.lng !== undefined ? (
                    <>
                      <span className="tabular-nums">{incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}</span>
                      <a
                        href={`https://www.google.com/maps?q=${incident.lat},${incident.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ptr-green font-medium hover:underline"
                      >
                        View on map
                      </a>
                    </>
                  ) : (
                    <span>No GPS location captured for this report</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </Page>

      {formOpen && currentUser && (
        <ReportForm
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          defaultRangeId={hasNoFixedRange ? '' : activeRangeId}
          lockRange={lockRange && !!activeRangeId}
          allowedRangeIds={hasNoFixedRange ? undefined : rangeIds}
        />
      )}

      {followUpFor && currentUser && (
        <TaskForm
          isOpen={!!followUpFor}
          onClose={() => setFollowUpFor(null)}
          onSave={async (data, files) => {
            const rows = await createTask.mutateAsync(data);
            for (const row of rows) {
              for (const file of files) {
                try { await uploadTaskAttachment(row.id, currentUser.id, file); }
                catch (err) { alert(getErrorMessage(err, `Failed to upload "${file.name}"`)); }
              }
            }
            setFollowUpFor(null);
          }}
          assignableUsers={assignableUsers}
          initialData={null}
          currentUserId={currentUser.id}
          defaultRangeId={followUpFor.rangeId}
          prefill={{
            title: `Follow-up: ${formatIncidentType(followUpFor)}`,
            description: `Linked to incident reported ${formatDateTime(followUpFor.incidentDate)}:\n${followUpFor.description}`,
            priority: SEVERITY_TO_PRIORITY[followUpFor.severity],
          }}
        />
      )}
    </>
  );
}
