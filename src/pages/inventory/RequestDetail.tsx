import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, X } from 'lucide-react';
import useStore from '../../store/useStore';
import { useInventoryRequests } from '../../hooks/useInventoryRequests';
import { useInventoryStock } from '../../hooks/useInventoryStock';
import { canManageInventory } from '../../lib/permissions';
import { inventoryBase } from '../../lib/inventoryBase';
import { quantityInputStep, validateQuantity } from '../../lib/inventoryQuantity';
import { CommandBar, ContextPanel } from '../../components/layout/Slots';
import { Page, PageHeading } from '../../components/layout/Page';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import EvidenceCapture, { EMPTY_EVIDENCE, type CapturedEvidence } from '../../components/mobile/EvidenceCapture';
import { getErrorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../utils/formatters';
import type { InventoryRequestStatus } from '../../types';

const STATUS_TONE: Record<InventoryRequestStatus, string> = {
  Draft: 'bg-n-20 text-n-80',
  Submitted: 'bg-signal-amber/10 text-signal-amber',
  Approved: 'bg-ptr-green/10 text-ptr-green',
  PartiallyApproved: 'bg-signal-amber/10 text-signal-amber',
  Rejected: 'bg-signal-red-bg text-signal-red',
  PartiallyFulfilled: 'bg-ptr-accent/10 text-ptr-accent',
  Fulfilled: 'bg-ptr-green/10 text-ptr-green',
  Cancelled: 'bg-n-20 text-n-70',
};

export default function InventoryRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = canManageInventory(currentUser?.role);
  const base = inventoryBase(currentUser?.role);
  const { requests, isLoading, cancelRequest, approveRequest, rejectRequest, issueStock, addPhotos, removePhoto } = useInventoryRequests();
  const { stock } = useInventoryStock();
  const request = requests.find((r) => r.id === id);
  const [approvals, setApprovals] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [issueQty, setIssueQty] = useState<Record<string, string>>({});
  const [addPhotosOpen, setAddPhotosOpen] = useState(false);
  const [newPhotos, setNewPhotos] = useState<CapturedEvidence>(EMPTY_EVIDENCE);
  // One idempotency key per outstanding issue action, generated lazily and
  // reused across a retry (e.g. the user re-clicking Issue after a network
  // timeout) so the server can recognize and skip a duplicate — cleared
  // only once the action actually succeeds.
  const issueKeys = useRef<Record<string, string>>({});

  if (isLoading) return <><ContextPanel><InventorySubNav /></ContextPanel><Page><div className="skeleton h-40" /></Page></>;
  if (!request) return <><ContextPanel><InventorySubNav /></ContextPanel><Page><PageHeading title="Request not found" /></Page></>;

  const canCancel = !isDirector && (request.status === 'Draft' || request.status === 'Submitted');
  const canApprove = isDirector && request.status === 'Submitted';
  const canIssue = isDirector && (request.status === 'Approved' || request.status === 'PartiallyApproved');

  const doApprove = async () => {
    const items = request.items.map((it) => ({
      requestItemId: it.id,
      approvedQty: Number(approvals[it.id] ?? it.requestedQty),
      allowsFractional: it.allowsFractional,
      requestedQty: it.requestedQty,
    }));
    for (const it of items) {
      const error = validateQuantity(it.approvedQty, it.allowsFractional);
      if (error) return alert(error);
      if (it.approvedQty > it.requestedQty) return alert('Approved quantity cannot exceed the requested quantity.');
    }
    try {
      await approveRequest.mutateAsync({
        requestId: request.id,
        approvals: items.map(({ requestItemId, approvedQty }) => ({ requestItemId, approvedQty })),
        requesterId: request.requestedBy,
      });
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to approve the request.'));
    }
  };

  const doReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectRequest.mutateAsync({ requestId: request.id, reason: rejectReason.trim(), requesterId: request.requestedBy });
      setRejectOpen(false);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to reject the request.'));
    }
  };

  const doIssue = async (requestItemId: string) => {
    const qty = Number(issueQty[requestItemId]);
    const line = request.items.find((it) => it.id === requestItemId);
    const error = validateQuantity(qty, line?.allowsFractional);
    if (error) return alert(error);
    const idempotencyKey = issueKeys.current[requestItemId] ??= crypto.randomUUID();
    try {
      await issueStock.mutateAsync({
        requestItemId, locationId: request.requestingLocationId, quantity: qty,
        requestId: request.id, requesterId: request.requestedBy, itemId: line?.itemId, idempotencyKey,
      });
      delete issueKeys.current[requestItemId];
      setIssueQty((q) => ({ ...q, [requestItemId]: '' }));
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to issue stock for this item.'));
    }
  };

  const doCancel = async () => {
    if (!confirm('Cancel this request?')) return;
    try {
      await cancelRequest.mutateAsync(request.id);
      navigate(`${base}/requests`);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to cancel the request.'));
    }
  };

  const doAddPhotos = async () => {
    if (newPhotos.photos.length === 0) return;
    try {
      await addPhotos.mutateAsync({ requestId: request.id, files: newPhotos.photos });
      setNewPhotos(EMPTY_EVIDENCE);
      setAddPhotosOpen(false);
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to upload one or more photos.'));
    }
  };

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      <CommandBar>
        <button onClick={() => navigate(`${base}/requests`)} className="btn-subtle"><ArrowLeft className="w-4 h-4" />Back</button>
      </CommandBar>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-n-100">{request.requestingLocationName ?? 'Request'}</h1>
          <span className={`text-xs font-semibold px-2 h-6 rounded-full flex items-center ${STATUS_TONE[request.status]}`}>{request.status}</span>
        </div>
        <p className="text-13 text-n-80 mt-0.5">
          Requested by {request.requestedByName ?? '—'} on {formatDateTime(request.createdAt)}
          {request.requiredByDate && ` · Needed by ${formatDate(request.requiredByDate)}`} · {request.priority} priority
        </p>
        {request.reason && <p className="text-13 text-n-90 mt-2">{request.reason}</p>}
        {request.status === 'Rejected' && request.rejectReason && (
          <p className="text-13 text-signal-red mt-2">Rejected: {request.rejectReason}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-13 font-semibold text-n-90">Photos ({request.photos.length})</span>
          {!addPhotosOpen && (
            <button onClick={() => setAddPhotosOpen(true)} className="text-13 font-medium text-ptr-accent flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" />Add
            </button>
          )}
        </div>
        {request.photos.length === 0 && !addPhotosOpen && (
          <p className="text-13 text-n-70 italic">No photos attached.</p>
        )}
        {request.photos.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {request.photos.map((photo) => (
              <div key={photo.id} className="relative w-16 h-16 rounded overflow-hidden border border-n-30 flex-shrink-0 group">
                <a href={photo.url} target="_blank" rel="noopener noreferrer">
                  <img src={photo.url} alt="" className="w-full h-full object-cover" />
                </a>
                <button
                  onClick={() => { if (confirm('Remove this photo?')) removePhoto.mutate(photo.id); }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white items-center justify-center hidden group-hover:flex"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {addPhotosOpen && (
          <div className="card p-3 space-y-2">
            <EvidenceCapture value={newPhotos} onChange={setNewPhotos} photosOnly showGps={false} showNote={false} />
            <div className="flex gap-2">
              <button onClick={() => void doAddPhotos()} disabled={addPhotos.isPending || newPhotos.photos.length === 0} className="btn-primary">Upload</button>
              <button onClick={() => { setAddPhotosOpen(false); setNewPhotos(EMPTY_EVIDENCE); }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="card divide-y divide-n-20">
        {request.items.map((it) => {
          const remainingApproved = (it.approvedQty ?? 0) - it.fulfilledQty;
          const availableAtLocation = stock.find(
            (s) => s.itemId === it.itemId && s.locationId === request.requestingLocationId,
          )?.availableQty ?? 0;
          const shortOfLocal = canIssue && remainingApproved > availableAtLocation;
          const issueMax = Math.max(0, Math.min(remainingApproved, availableAtLocation));
          return (
            <div key={it.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-13 font-semibold text-n-100 truncate">{it.itemName ?? 'Unknown item'}</div>
                  <div className="text-xs text-n-70">
                    Requested {it.requestedQty} {it.unitAbbreviation ?? ''}
                    {it.approvedQty !== undefined && ` · Approved ${it.approvedQty}`}
                    {it.fulfilledQty > 0 && ` · Issued ${it.fulfilledQty}`}
                  </div>
                </div>
                {canApprove && (
                  <input
                    type="number" min="0" max={it.requestedQty} step={quantityInputStep(it.allowsFractional)}
                    placeholder={String(it.requestedQty)}
                    value={approvals[it.id] ?? ''}
                    onChange={(e) => setApprovals((a) => ({ ...a, [it.id]: e.target.value }))}
                    className="input-field w-24 flex-shrink-0"
                  />
                )}
              </div>
              {canIssue && remainingApproved > 0 && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number" min="1" max={issueMax || undefined} step={quantityInputStep(it.allowsFractional)}
                      placeholder="Qty to issue"
                      value={issueQty[it.id] ?? ''}
                      onChange={(e) => setIssueQty((q) => ({ ...q, [it.id]: e.target.value }))}
                      className="input-field w-28 flex-shrink-0"
                    />
                    <button
                      onClick={() => void doIssue(it.id)} disabled={issueStock.isPending || issueMax <= 0}
                      title="Issue from this location's own stock"
                      className="btn-secondary flex-1 min-w-[120px]"
                    >
                      Issue
                    </button>
                  </div>
                  {shortOfLocal && (
                    <p className="text-xs text-signal-amber mt-1">
                      Only {availableAtLocation} {it.unitAbbreviation ?? ''} available at {request.requestingLocationName ?? 'this location'}.
                      Inter-location fulfilment will be available in the Transfers workflow.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canApprove && !rejectOpen && (
        <div className="flex gap-2">
          <button onClick={() => void doApprove()} disabled={approveRequest.isPending} className="btn-primary">Approve</button>
          <button onClick={() => setRejectOpen(true)} className="btn-secondary">Reject</button>
        </div>
      )}
      {rejectOpen && (
        <div className="card p-4 space-y-2 max-w-md">
          <label className="block text-13 font-medium text-n-90">Reason for rejection</label>
          <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2} className="input-field resize-none" style={{ fontSize: '16px' }} />
          <div className="flex gap-2">
            <button onClick={() => void doReject()} disabled={rejectRequest.isPending || !rejectReason.trim()} className="btn-primary">Confirm reject</button>
            <button onClick={() => setRejectOpen(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}
      {canCancel && (
        <button onClick={() => void doCancel()} disabled={cancelRequest.isPending} className="btn-secondary">Cancel request</button>
      )}
      </Page>
    </>
  );
}
