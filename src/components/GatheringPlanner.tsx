import { FormEvent, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Info,
  LoaderCircle,
  MapPin,
  MessageCircle,
} from 'lucide-react';
import { ApiError } from '../api/client';
import { engagementApi } from '../api/engagement';
import type { PersistentGathering, PreparedInvitation } from '../engagementTypes';
import { absoluteInvitationUrl } from '../lib/agentInvitationLinks';
import { formatDubaiDateTime, toDubaiIso } from '../lib/gatheringDate';
import {
  createGatheringPlannerDraft,
  createGatheringPlannerIdempotencyKey,
  createGatheringPlannerSubmissionController,
  gatheringInputFromDraft,
  GATHERING_TYPES,
  type GatheringPlannerDraft,
  type GatheringPlannerPrefill,
  type GatheringPlannerSource,
  type GatheringPlannerSubmissionResult,
  type InvitationChannel,
} from '../lib/gatheringPlanner';
import { cn } from '../lib/utils';
import type { FamilyMember } from '../types';

export type GatheringPlannerStage = 'details' | 'review' | 'saved' | 'links';

export interface GatheringPlannerProps {
  familyId: string;
  members: FamilyMember[];
  /** A prepared hand-off. Missing startAt intentionally leaves date/time blank. */
  prefill?: GatheringPlannerPrefill;
  source?: GatheringPlannerSource;
  sourceLabel?: string;
  /** Defaults are used only when prefill is absent (a manual Calendar draft). */
  defaultDate?: string;
  defaultTime?: string;
  /** Persisted AI message ID; protects final create across refresh/reopen. */
  idempotencyKey?: string;
  initialCreateOutcomeUncertain?: boolean;
  onCancel: () => void;
  onGatheringChanged?: (gathering: PersistentGathering) => void;
  onSubmissionResult?: (result: GatheringPlannerSubmissionResult) => void;
  onViewCalendar?: (gathering: PersistentGathering) => void;
  onStageChange?: (stage: GatheringPlannerStage) => void;
  onBusyChange?: (busy: boolean) => void;
  onCreateOutcomeUncertainChange?: (uncertain: boolean) => void;
  onDiscardUncertainRetry?: () => void;
  className?: string;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
}

function MemberPicker({
  members,
  selected,
  onToggle,
}: {
  members: FamilyMember[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (members.length === 0) {
    return <p className="rounded-xl border border-dashed border-sepia p-4 text-xs text-ink/50">Add family members to the Bond Map before preparing invitation links.</p>;
  }

  return (
    <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto rounded-2xl border border-sepia/60 bg-sand/10 p-3 sm:grid-cols-2">
      {members.map(member => (
        <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-xl p-2 hover:bg-sand/50">
          <input
            type="checkbox"
            checked={selected.includes(member.id)}
            onChange={() => onToggle(member.id)}
            className="accent-[#b88a44]"
          />
          {member.photo ? (
            <img src={member.photo} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-sepia/30 text-[10px] font-bold">{member.name.slice(0, 1)}</span>
          )}
          <span className="truncate text-xs font-semibold">{member.name}</span>
        </label>
      ))}
    </div>
  );
}

function PreparedLinks({
  invitations,
  gathering,
  deliveryNotice,
}: {
  invitations: PreparedInvitation[];
  gathering: PersistentGathering;
  deliveryNotice: string;
}) {
  const [copiedMemberId, setCopiedMemberId] = useState('');
  const [copyError, setCopyError] = useState('');

  const copyLink = async (invitation: PreparedInvitation, invitationUrl: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopiedMemberId(invitation.memberId);
      window.setTimeout(() => setCopiedMemberId(''), 1_800);
    } catch {
      setCopyError('The browser blocked clipboard access. Open the link and copy it from the address bar.');
    }
  };

  const openWhatsApp = (invitationUrl: string) => {
    // This is intentionally user-triggered. Preparing links never opens an app
    // and never sends a message automatically.
    const message = `Family gathering invitation: ${gathering.title} on ${formatDubaiDateTime(gathering.startAt, 'short')}. Please RSVP: ${invitationUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900" role="status">
        <p className="flex items-center gap-2 font-bold"><Check size={14} /> {gathering.title} was saved</p>
      </div>
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
        <p className="flex items-center gap-2 font-bold"><Info size={14} /> Links prepared, not sent</p>
        <p className="mt-1 leading-relaxed">{deliveryNotice}</p>
        {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? (
          <p className="mt-2 font-medium">Localhost links normally work only on this computer. Deploy the app before sharing with another device.</p>
        ) : null}
      </div>
      <div className="space-y-2">
        {invitations.map(invitation => {
          const invitationUrl = absoluteInvitationUrl(invitation, window.location.origin);
          return (
            <div key={invitation.memberId} className="rounded-2xl border border-sepia bg-white p-3">
              <p className="text-xs font-bold text-ink">{invitation.memberName}</p>
              {invitationUrl ? (
                <>
                  <p className="mt-1 truncate text-[10px] text-ink/45">{invitationUrl}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyLink(invitation, invitationUrl)} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white hover:bg-gold">
                      {copiedMemberId === invitation.memberId ? <Check size={12} /> : <Copy size={12} />}
                      {copiedMemberId === invitation.memberId ? 'Copied' : 'Copy link'}
                    </button>
                    <a href={invitationUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-sepia px-3 py-2 text-[9px] font-bold uppercase tracking-wider hover:border-gold">
                      <ExternalLink size={12} /> Preview
                    </a>
                    {invitation.whatsappUrl ? (
                      <button type="button" onClick={() => openWhatsApp(invitationUrl)} className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-green-800 hover:bg-green-100">
                        <MessageCircle size={12} /> Open WhatsApp
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p role="alert" className="mt-2 text-xs text-red-700">This invitation link is unavailable. Prepare a new link before sharing.</p>
              )}
            </div>
          );
        })}
      </div>
      {copyError ? <p role="alert" className="text-xs text-red-700">{copyError}</p> : null}
    </div>
  );
}

function SourceNotice({ source, sourceLabel }: { source: GatheringPlannerSource; sourceLabel?: string }) {
  if (source === 'ai') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <Info size={13} className="mr-1 inline" /> Prepared by AI. Review every detail before saving. Nothing will be sent automatically.
      </div>
    );
  }

  if (source === 'reconnection') {
    return (
      <div className="rounded-xl border border-sepia bg-sand/30 p-3 text-xs text-ink/60">
        <Info size={13} className="mr-1 inline text-gold" /> Prefilled from the stored plan{sourceLabel ? ` “${sourceLabel}”` : ''}. This is editable and nothing is saved or shared until you review and confirm.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sepia bg-sand/30 p-3 text-xs text-ink/60">
      <Info size={13} className="mr-1 inline text-gold" /> Nothing is saved or shared until you review and confirm.
    </div>
  );
}

export function GatheringPlanner({
  familyId,
  members,
  prefill,
  source = 'manual',
  sourceLabel,
  defaultDate = '',
  defaultTime = '',
  idempotencyKey,
  initialCreateOutcomeUncertain = false,
  onCancel,
  onGatheringChanged,
  onSubmissionResult,
  onViewCalendar,
  onStageChange,
  onBusyChange,
  onCreateOutcomeUncertainChange,
  onDiscardUncertainRetry,
  className,
}: GatheringPlannerProps) {
  const [stage, setStage] = useState<GatheringPlannerStage>('details');
  const [draft, setDraft] = useState<GatheringPlannerDraft>(() => createGatheringPlannerDraft({
    prefill,
    availableMemberIds: members.map(member => member.id),
    defaultDate,
    defaultTime,
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createOutcomeUncertain, setCreateOutcomeUncertain] = useState(initialCreateOutcomeUncertain);
  const [savedGathering, setSavedGathering] = useState<PersistentGathering | null>(null);
  const [prepared, setPrepared] = useState<{
    invitations: PreparedInvitation[];
    deliveryNotice: string;
  } | null>(null);
  const submissionController = useRef<ReturnType<typeof createGatheringPlannerSubmissionController> | null>(null);
  if (!submissionController.current) {
    submissionController.current = createGatheringPlannerSubmissionController(
      engagementApi,
      idempotencyKey ?? createGatheringPlannerIdempotencyKey(),
    );
  }

  const moveToStage = (nextStage: GatheringPlannerStage) => {
    setStage(nextStage);
    onStageChange?.(nextStage);
  };

  const updateDraft = <K extends keyof GatheringPlannerDraft>(key: K, value: GatheringPlannerDraft[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
  };

  const toggleDraftMember = (id: string) => {
    updateDraft(
      'memberIds',
      draft.memberIds.includes(id)
        ? draft.memberIds.filter(item => item !== id)
        : [...draft.memberIds, id],
    );
  };

  const reviewDraft = (event: FormEvent) => {
    event.preventDefault();
    setSaveError('');
    try {
      gatheringInputFromDraft(draft);
      moveToStage('review');
    } catch (caught) {
      setSaveError(errorMessage(caught, 'Choose valid gathering details.'));
    }
  };

  const saveAndPrepare = async () => {
    if (saving) return;
    setSaving(true);
    onBusyChange?.(true);
    setSaveError('');
    try {
      const result = await submissionController.current.submit(familyId, draft);
      setCreateOutcomeUncertain(false);
      onCreateOutcomeUncertainChange?.(false);
      setSavedGathering(result.gathering);
      onGatheringChanged?.(result.gathering);
      onSubmissionResult?.(result);

      if (result.invitationError) {
        setSaveError(`The gathering was saved, but invitation links were not prepared. ${errorMessage(result.invitationError, 'Try preparing the links again.')} Retry here now, or prepare links later from Calendar.`);
        return;
      }

      if (result.prepared) {
        setPrepared({
          invitations: result.prepared.invitations,
          deliveryNotice: result.prepared.deliveryNotice,
        });
        moveToStage('links');
      } else {
        moveToStage('saved');
      }
    } catch (caught) {
      const nextOutcomeUncertain = createOutcomeUncertain || (
        !savedGathering
        && (!(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500)
      );
      setCreateOutcomeUncertain(nextOutcomeUncertain);
      onCreateOutcomeUncertainChange?.(nextOutcomeUncertain);
      setSaveError(errorMessage(caught, 'Unable to save the gathering.'));
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  const finish = () => {
    if (savedGathering && onViewCalendar) {
      onViewCalendar(savedGathering);
      return;
    }
    onCancel();
  };

  return (
    <section className={cn('flex min-h-0 flex-1 flex-col bg-white', className)} aria-label="Gathering planner">
      {stage === 'details' ? (
        <form onSubmit={reviewDraft} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto p-6 text-sm">
            <SourceNotice source={source} sourceLabel={sourceLabel} />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <MapPin size={13} className="mr-1 inline" /> The location is a planning label only. Its existence, hours, availability, accessibility, and suitability have not been verified.
            </div>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Title</span>
              <input required minLength={2} maxLength={120} value={draft.title} onChange={event => updateDraft('title', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5 outline-none focus:border-gold" placeholder="Friday family dinner" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Purpose</span>
              <input required minLength={2} maxLength={500} value={draft.purpose} onChange={event => updateDraft('purpose', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5 outline-none focus:border-gold" placeholder="Reconnect after a busy month" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Date</span>
                <input required type="date" value={draft.date} onChange={event => updateDraft('date', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-3 py-2.5" />
              </label>
              <label>
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Dubai time</span>
                <input required type="time" value={draft.time} onChange={event => updateDraft('time', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-3 py-2.5" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Location</span>
              <input required minLength={2} maxLength={300} value={draft.locationName} onChange={event => updateDraft('locationName', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5" placeholder="Family home, Abu Dhabi" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Type</span>
              <select value={draft.type} onChange={event => updateDraft('type', event.target.value as GatheringPlannerDraft['type'])} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5">
                {GATHERING_TYPES.map(type => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Notes (optional)</span>
              <textarea maxLength={2_000} rows={2} value={draft.notes} onChange={event => updateDraft('notes', event.target.value)} className="w-full resize-none rounded-xl border border-sepia bg-sand/20 px-4 py-2.5" placeholder="Accessibility, food, or arrival details" />
            </label>
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">People to invite (optional)</span>
              <MemberPicker members={members} selected={draft.memberIds} onToggle={toggleDraftMember} />
            </div>
            {draft.memberIds.length > 0 ? (
              <label className="block">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Sharing option</span>
                <select value={draft.channel} onChange={event => updateDraft('channel', event.target.value as InvitationChannel)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5">
                  <option value="share_link">Copyable links</option>
                  <option value="whatsapp">WhatsApp share buttons</option>
                </select>
              </label>
            ) : null}
            {saveError ? <p role="alert" className="text-xs text-red-700">{saveError}</p> : null}
          </div>
          <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Cancel</button>
            <button type="submit" className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold">Review</button>
          </footer>
        </form>
      ) : stage === 'review' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto p-6">
            <div className="rounded-2xl border border-sepia p-5">
              <h4 className="font-serif text-xl font-bold italic">{draft.title}</h4>
              <p className="mt-1 text-xs text-ink/55">{draft.purpose}</p>
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <Clock size={14} className="mt-0.5 shrink-0 text-gold" />
                  <div><dt className="sr-only">Date and Dubai time</dt><dd>{formatDubaiDateTime(toDubaiIso(draft.date, draft.time))} (Asia/Dubai)</dd></div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-gold" />
                  <div><dt className="sr-only">Location</dt><dd>{draft.locationName}</dd></div>
                </div>
                <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className="font-bold text-ink/45">Type</dt><dd>{draft.type}</dd></div>
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <dt className="font-bold text-ink/45">Invitees</dt>
                  <dd>{draft.memberIds.length
                    ? draft.memberIds.map(id => members.find(member => member.id === id)?.name ?? 'Unavailable member').join(', ')
                    : 'None'}</dd>
                </div>
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <dt className="font-bold text-ink/45">Sharing</dt>
                  <dd>{draft.memberIds.length === 0
                    ? 'No links will be prepared'
                    : draft.channel === 'whatsapp'
                      ? 'WhatsApp share buttons'
                      : 'Copyable private links'}</dd>
                </div>
                <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className="font-bold text-ink/45">Notes</dt><dd className="whitespace-pre-wrap">{draft.notes || 'None'}</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
              <p className="font-bold">Final confirmation required</p>
              <p className="mt-1">Reviewing this page creates nothing. Confirming creates one gathering{draft.memberIds.length ? ' and prepares private links' : ''}. It never sends a message automatically.</p>
            </div>
            {saveError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{saveError}</p> : null}
            {createOutcomeUncertain ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                The server did not confirm whether the gathering was created. Retry with the same details from this planner. Its safe request key prevents an identical retry from creating a duplicate.
                {source === 'manual'
                  ? ' If you close, Calendar retains that key for the next manual retry.'
                  : ' Keep this planner open until the outcome is resolved.'}
                {onDiscardUncertainRetry ? (
                  <button type="button" onClick={onDiscardUncertainRetry} className="mt-3 block font-bold underline underline-offset-2">
                    Start a new draft instead
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4">
            {savedGathering && saveError && onViewCalendar ? (
              <button type="button" disabled={saving} onClick={finish} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider disabled:opacity-40">Prepare later in Calendar</button>
            ) : null}
            <button type="button" disabled={saving || Boolean(savedGathering)} onClick={() => moveToStage('details')} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider disabled:opacity-40">Back</button>
            <button type="button" disabled={saving} onClick={() => void saveAndPrepare()} className="flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold disabled:opacity-50">
              {saving ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />}
              {savedGathering ? 'Retry link preparation' : draft.memberIds.length ? 'Create & prepare links' : 'Create draft'}
            </button>
          </footer>
        </div>
      ) : stage === 'links' && savedGathering && prepared ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="overflow-y-auto p-6">
            <PreparedLinks invitations={prepared.invitations} gathering={savedGathering} deliveryNotice={prepared.deliveryNotice} />
          </div>
          <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Done</button>
            {onViewCalendar ? <button type="button" onClick={finish} className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white">View Calendar</button> : null}
          </footer>
        </div>
      ) : stage === 'saved' && savedGathering ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto p-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950" role="status">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Check size={14} /> Gathering saved</p>
              <h4 className="mt-2 font-serif text-xl font-bold italic">{savedGathering.title}</h4>
              <p className="mt-2 text-xs">{formatDubaiDateTime(savedGathering.startAt)}</p>
              <p className="mt-1 text-xs">No invitation links were created.</p>
            </div>
          </div>
          <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Done</button>
            {onViewCalendar ? <button type="button" onClick={finish} className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white">View Calendar</button> : null}
          </footer>
        </div>
      ) : null}
    </section>
  );
}

export type {
  GatheringPlannerDraft,
  GatheringPlannerPrefill,
  GatheringPlannerSource,
  GatheringPlannerSubmissionResult,
  InvitationChannel,
} from '../lib/gatheringPlanner';
