import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Link2,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Users,
  X,
} from 'lucide-react';
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError } from '../api/client';
import { engagementApi } from '../api/engagement';
import type { GatheringPlanPrefill } from '../api/reconnectionPlans';
import type { PersistentGathering, PreparedInvitation, RsvpStatus } from '../engagementTypes';
import { dubaiTodayKey, formatDubaiDateKey, formatDubaiDateTime, toDubaiIso } from '../lib/gatheringDate';
import { cn } from '../lib/utils';
import type { FamilyMember, FamilyRole } from '../types';

interface CalendarProps {
  familyId: string;
  members: FamilyMember[];
  familyRole?: FamilyRole;
  currentUserId?: string;
  planPrefill?: GatheringPlanPrefill | null;
  onPlanPrefillConsumed?: () => void;
  onGatheringsChanged?: (gatherings: PersistentGathering[]) => void;
  refreshVersion?: number;
}

type InvitationChannel = 'share_link' | 'whatsapp';
type PlannerStage = 'details' | 'review' | 'links';

interface GatheringDraft {
  title: string;
  purpose: string;
  date: string;
  time: string;
  type: string;
  locationName: string;
  notes: string;
  memberIds: string[];
  channel: InvitationChannel;
}

const newDraft = (date = dubaiTodayKey()): GatheringDraft => ({
  title: '',
  purpose: '',
  date,
  time: '18:30',
  type: 'Family gathering',
  locationName: '',
  notes: '',
  memberIds: [],
  channel: 'share_link',
});

const dateFromKey = (key: string) => new Date(`${key}T12:00:00`);

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
}

function StatusPill({ status }: { status: RsvpStatus | PersistentGathering['status'] }) {
  const labels: Record<string, string> = {
    pending: 'Pending',
    going: 'Going',
    maybe: 'Maybe',
    declined: 'Declined',
    draft: 'Draft',
    inviting: 'Inviting',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return (
    <span className={cn(
      'rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-wider',
      status === 'going' && 'bg-green-100 text-green-800',
      status === 'maybe' && 'bg-amber-100 text-amber-800',
      status === 'declined' && 'bg-red-100 text-red-700',
      (status === 'pending' || status === 'draft') && 'bg-gray-100 text-gray-600',
      status === 'inviting' && 'bg-blue-100 text-blue-800',
      status === 'completed' && 'bg-emerald-100 text-emerald-800',
      status === 'cancelled' && 'bg-red-100 text-red-700',
    )}>
      {labels[status] ?? status}
    </span>
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

  const absoluteLink = (invitation: PreparedInvitation) => invitation.shareUrl ?? new URL(invitation.sharePath, window.location.origin).toString();
  const copyLink = async (invitation: PreparedInvitation) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(absoluteLink(invitation));
      setCopiedMemberId(invitation.memberId);
      window.setTimeout(() => setCopiedMemberId(''), 1800);
    } catch {
      setCopyError('The browser blocked clipboard access. Open the link and copy it from the address bar.');
    }
  };
  const openWhatsApp = (invitation: PreparedInvitation) => {
    // Build this client-side so the shared message always contains an absolute
    // URL, including when an older server returned a relative WhatsApp link.
    const message = `Family gathering invitation: ${gathering.title} on ${formatDubaiDateTime(gathering.startAt, 'short')}. Please RSVP: ${absoluteLink(invitation)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
        <p className="font-bold flex items-center gap-2"><Info size={14} /> Links prepared, not sent</p>
        <p className="mt-1 leading-relaxed">{deliveryNotice}</p>
        {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? (
          <p className="mt-2 font-medium">Localhost links normally work only on this computer. Deploy the app before sharing with another device.</p>
        ) : null}
      </div>
      <div className="space-y-2">
        {invitations.map(invitation => (
          <div key={invitation.memberId} className="rounded-2xl border border-sepia bg-white p-3">
            <p className="text-xs font-bold text-ink">{invitation.memberName}</p>
            <p className="mt-1 truncate text-[10px] text-ink/45">{absoluteLink(invitation)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyLink(invitation)} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white hover:bg-gold">
                {copiedMemberId === invitation.memberId ? <Check size={12} /> : <Copy size={12} />}
                {copiedMemberId === invitation.memberId ? 'Copied' : 'Copy link'}
              </button>
              <a href={absoluteLink(invitation)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-sepia px-3 py-2 text-[9px] font-bold uppercase tracking-wider hover:border-gold">
                <ExternalLink size={12} /> Preview
              </a>
              {invitation.whatsappUrl ? (
                <button type="button" onClick={() => openWhatsApp(invitation)} className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-green-800 hover:bg-green-100">
                  <MessageCircle size={12} /> Open WhatsApp
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {copyError ? <p role="alert" className="text-xs text-red-700">{copyError}</p> : null}
    </div>
  );
}

function MemberPicker({ members, selected, onToggle }: { members: FamilyMember[]; selected: string[]; onToggle: (id: string) => void }) {
  if (members.length === 0) {
    return <p className="rounded-xl border border-dashed border-sepia p-4 text-xs text-ink/50">Add family members to the Bond Map before preparing invitation links.</p>;
  }
  return (
    <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto rounded-2xl border border-sepia/60 bg-sand/10 p-3 sm:grid-cols-2">
      {members.map(member => (
        <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-xl p-2 hover:bg-sand/50">
          <input type="checkbox" checked={selected.includes(member.id)} onChange={() => onToggle(member.id)} className="accent-[#b88a44]" />
          {member.photo ? <img src={member.photo} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sepia/30 text-[10px] font-bold">{member.name.slice(0, 1)}</span>}
          <span className="truncate text-xs font-semibold">{member.name}</span>
        </label>
      ))}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <motion.section initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-sepia bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-sepia bg-sand px-6 py-5">
          <h3 className="font-serif text-xl font-bold italic text-ink">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-sepia/30" aria-label="Close"><X size={20} /></button>
        </header>
        {children}
      </motion.section>
    </div>
  );
}

export function Calendar({
  familyId,
  members,
  familyRole,
  currentUserId,
  planPrefill,
  onPlanPrefillConsumed,
  onGatheringsChanged,
  refreshVersion = 0,
}: CalendarProps) {
  const todayKey = dubaiTodayKey();
  const [currentMonth, setCurrentMonth] = useState(() => dateFromKey(todayKey));
  const [selectedDate, setSelectedDate] = useState(() => dateFromKey(todayKey));
  const [gatherings, setGatherings] = useState<PersistentGathering[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerStage, setPlannerStage] = useState<PlannerStage>('details');
  const [draft, setDraft] = useState<GatheringDraft>(() => newDraft(todayKey));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedGathering, setSavedGathering] = useState<PersistentGathering | null>(null);
  const [prepared, setPrepared] = useState<{ invitations: PreparedInvitation[]; deliveryNotice: string } | null>(null);
  const [inviteTarget, setInviteTarget] = useState<PersistentGathering | null>(null);
  const [inviteStage, setInviteStage] = useState<'choose' | 'review' | 'links'>('choose');
  const [inviteMemberIds, setInviteMemberIds] = useState<string[]>([]);
  const [inviteChannel, setInviteChannel] = useState<InvitationChannel>('share_link');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invitePrepared, setInvitePrepared] = useState<{ invitations: PreparedInvitation[]; deliveryNotice: string; gathering: PersistentGathering } | null>(null);
  const [completionBusyId, setCompletionBusyId] = useState('');
  const [operationMessage, setOperationMessage] = useState('');
  const [operationError, setOperationError] = useState('');
  const [plannerSourcePlanTitle, setPlannerSourcePlanTitle] = useState('');

  const publishGatherings = useCallback((next: PersistentGathering[]) => {
    setGatherings(next);
    onGatheringsChanged?.(next);
  }, [onGatheringsChanged]);

  const loadGatherings = useCallback(async () => {
    if (!familyId) return;
    setLoading(true);
    setLoadError('');
    try {
      const result = await engagementApi.listGatherings(familyId);
      publishGatherings(result.gatherings);
    } catch (caught) {
      setLoadError(errorMessage(caught, 'Unable to load family gatherings.'));
    } finally {
      setLoading(false);
    }
  }, [familyId, publishGatherings]);

  useEffect(() => { void loadGatherings(); }, [loadGatherings, refreshVersion]);

  useEffect(() => {
    if (!planPrefill) return;
    const availableMemberIds = new Set(members.map((member) => member.id));
    setDraft({
      ...newDraft(todayKey),
      title: planPrefill.title.slice(0, 120),
      purpose: planPrefill.purpose.slice(0, 500),
      type: planPrefill.type.slice(0, 80),
      locationName: planPrefill.locationName.slice(0, 300),
      notes: planPrefill.notes.slice(0, 2_000),
      memberIds: planPrefill.memberIds.filter((id) => availableMemberIds.has(id)),
    });
    setPlannerSourcePlanTitle(planPrefill.sourcePlanTitle);
    setPlannerStage('details');
    setSavedGathering(null);
    setPrepared(null);
    setSaveError('');
    setPlannerOpen(true);
    onPlanPrefillConsumed?.();
  }, [members, onPlanPrefillConsumed, planPrefill, todayKey]);

  const startDate = startOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: startDate, end: endOfMonth(currentMonth) });
  const selectedKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedGatherings = gatherings.filter(gathering => formatDubaiDateKey(gathering.startAt) === selectedKey);
  const nextGathering = useMemo(() => gatherings
    .filter(gathering => new Date(gathering.startAt).getTime() >= Date.now() && gathering.status !== 'cancelled')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0], [gatherings]);

  const updateDraft = <K extends keyof GatheringDraft>(key: K, value: GatheringDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const toggleDraftMember = (id: string) => updateDraft('memberIds', draft.memberIds.includes(id) ? draft.memberIds.filter(item => item !== id) : [...draft.memberIds, id]);
  const openPlanner = (dateKey = selectedKey) => {
    setDraft(newDraft(dateKey));
    setPlannerSourcePlanTitle('');
    setPlannerStage('details');
    setSavedGathering(null);
    setPrepared(null);
    setSaveError('');
    setPlannerOpen(true);
  };
  const closePlanner = () => {
    if (saving) return;
    setPlannerOpen(false);
    setPlannerStage('details');
    setSavedGathering(null);
    setPrepared(null);
    setPlannerSourcePlanTitle('');
  };

  const canManageGathering = (gathering: PersistentGathering) => (
    familyRole === 'owner' || familyRole === 'admin' || gathering.createdByUserId === currentUserId
  );
  const canCompleteGathering = familyRole === 'owner' || familyRole === 'admin';

  const reviewDraft = (event: FormEvent) => {
    event.preventDefault();
    setSaveError('');
    try {
      toDubaiIso(draft.date, draft.time);
      setPlannerStage('review');
    } catch (caught) {
      setSaveError(errorMessage(caught, 'Choose a valid gathering date and time.'));
    }
  };

  const saveAndPrepare = async () => {
    setSaving(true);
    setSaveError('');
    let gathering = savedGathering;
    try {
      if (!gathering) {
        const created = await engagementApi.createGathering(familyId, {
          title: draft.title.trim(),
          purpose: draft.purpose.trim(),
          startAt: toDubaiIso(draft.date, draft.time),
          timezone: 'Asia/Dubai',
          locationName: draft.locationName.trim(),
          notes: draft.notes.trim() || undefined,
          type: draft.type,
        });
        gathering = created.gathering;
        setSavedGathering(gathering);
        publishGatherings([...gatherings.filter(item => item.id !== gathering!.id), gathering].sort((a, b) => a.startAt.localeCompare(b.startAt)));
      }

      if (draft.memberIds.length === 0) {
        setPlannerOpen(false);
        setSelectedDate(dateFromKey(draft.date));
        setCurrentMonth(dateFromKey(draft.date));
        return;
      }

      const result = await engagementApi.prepareInvitations(gathering.id, { memberIds: draft.memberIds, channel: draft.channel });
      setPrepared({ invitations: result.invitations, deliveryNotice: result.deliveryNotice });
      setSavedGathering(result.gathering);
      publishGatherings(
        [...gatherings.filter(item => item.id !== result.gathering.id), result.gathering]
          .sort((a, b) => a.startAt.localeCompare(b.startAt)),
      );
      setPlannerStage('links');
      setSelectedDate(dateFromKey(draft.date));
      setCurrentMonth(dateFromKey(draft.date));
    } catch (caught) {
      setSaveError(`${gathering ? 'The gathering was saved, but invitation links were not prepared. ' : ''}${errorMessage(caught, 'Unable to save the gathering.')}`);
    } finally {
      setSaving(false);
    }
  };

  const openInviteModal = (gathering: PersistentGathering) => {
    setInviteTarget(gathering);
    setInviteMemberIds([]);
    setInviteChannel('share_link');
    setInviteStage('choose');
    setInviteError('');
    setInvitePrepared(null);
  };
  const closeInviteModal = () => {
    if (inviteBusy) return;
    setInviteTarget(null);
    setInvitePrepared(null);
  };
  const prepareExistingInvitations = async () => {
    if (!inviteTarget || inviteMemberIds.length === 0) return;
    setInviteBusy(true);
    setInviteError('');
    try {
      const result = await engagementApi.prepareInvitations(inviteTarget.id, { memberIds: inviteMemberIds, channel: inviteChannel });
      setInvitePrepared(result);
      setInviteTarget(result.gathering);
      setInviteStage('links');
      publishGatherings(gatherings.map(item => item.id === result.gathering.id ? result.gathering : item));
    } catch (caught) {
      setInviteError(errorMessage(caught, 'Unable to prepare invitation links.'));
    } finally {
      setInviteBusy(false);
    }
  };

  const completeGathering = async (gathering: PersistentGathering) => {
    const attendees = gathering.invitations.filter(invitation => invitation.status === 'going');
    if (attendees.length < 2) {
      setOperationError('At least two invitees must RSVP Going before completion can be verified.');
      return;
    }
    if (!confirm(`Mark “${gathering.title}” completed with ${attendees.length} confirmed attendees?`)) return;
    setCompletionBusyId(gathering.id);
    setOperationError('');
    setOperationMessage('');
    try {
      const result = await engagementApi.completeGathering(gathering.id, attendees.map(invitation => invitation.memberId));
      publishGatherings(gatherings.map(item => item.id === result.gathering.id ? result.gathering : item));
      setOperationMessage(`Gathering completed. ${result.pointsAwarded} verified family points were added.`);
    } catch (caught) {
      setOperationError(errorMessage(caught, 'The gathering could not be completed.'));
    } finally {
      setCompletionBusyId('');
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-sepia pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-gold">Asia/Dubai timezone</p>
          <h2 className="font-serif text-3xl font-bold italic text-ink">{format(currentMonth, 'MMMM yyyy')}</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="rounded-full p-2 hover:bg-sand" aria-label="Previous month"><ChevronLeft size={20} /></button>
          <button onClick={() => setCurrentMonth(dateFromKey(todayKey))} className="rounded-full px-3 text-[9px] font-bold uppercase tracking-widest hover:bg-sand">Today</button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="rounded-full p-2 hover:bg-sand" aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
      </header>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{loadError}</span>
          <button onClick={() => void loadGatherings()} className="flex items-center gap-2 font-bold"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : null}
      {operationError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{operationError}</div> : null}
      {operationMessage ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{operationMessage}</div> : null}

      <section className="rounded-[2rem] border border-sepia bg-white p-4 shadow-sm sm:p-6" aria-label="Gathering calendar">
        <div className="grid grid-cols-7 gap-1">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <div key={day} className="py-2 text-center text-[9px] font-bold uppercase tracking-widest text-ink/35">{day}</div>)}
          {Array.from({ length: startDate.getDay() }).map((_, index) => <div key={`blank-${index}`} />)}
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const count = gatherings.filter(item => formatDubaiDateKey(item.startAt) === key).length;
            const selected = key === selectedKey;
            return (
              <button key={key} onClick={() => setSelectedDate(day)} className={cn('relative flex h-14 flex-col items-center justify-center rounded-2xl text-xs font-bold transition-all', selected ? 'scale-105 bg-ink text-white shadow-lg' : 'hover:bg-sand/60', key === todayKey && !selected && 'border border-gold text-gold')} aria-label={`${format(day, 'MMMM d')}${count ? `, ${count} gatherings` : ''}`}>
                {format(day, 'd')}
                {count > 0 ? <span className={cn('mt-1 h-1.5 w-1.5 rounded-full', selected ? 'bg-white' : 'bg-gold')} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sepia pb-4">
          <h3 className="font-serif text-2xl italic text-ink">{format(selectedDate, 'do MMMM')}</h3>
          <button onClick={() => openPlanner()} className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white shadow hover:bg-gold"><Plus size={15} /> Plan gathering</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-[2rem] border border-sepia bg-white p-10 text-sm text-ink/55"><LoaderCircle className="animate-spin text-gold" size={20} /> Loading gatherings…</div>
        ) : selectedGatherings.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-sepia bg-white/50 p-10 text-center">
            <CalendarIcon className="mx-auto text-gold" size={24} />
            <p className="mt-3 font-serif text-lg italic text-ink/50">No gathering planned for this day.</p>
          </div>
        ) : selectedGatherings.map(gathering => (
          <article key={gathering.id} className="rounded-[2rem] border border-sepia bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h4 className="font-serif text-xl font-bold italic">{gathering.title}</h4><StatusPill status={gathering.status} /></div>
                <p className="mt-1 text-xs text-ink/55">{gathering.purpose}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManageGathering(gathering) && gathering.status !== 'completed' && gathering.status !== 'cancelled' ? (
                  <button onClick={() => openInviteModal(gathering)} className="flex items-center gap-2 rounded-xl border border-sepia px-3 py-2 text-[9px] font-bold uppercase tracking-wider hover:border-gold"><Link2 size={13} /> Prepare links</button>
                ) : null}
                {canCompleteGathering && gathering.status === 'inviting' && new Date(gathering.startAt).getTime() <= Date.now() ? (
                  <button disabled={Boolean(completionBusyId)} onClick={() => void completeGathering(gathering)} className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white hover:bg-gold disabled:opacity-40">
                    {completionBusyId === gathering.id ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />} Complete
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-wider text-ink/50">
              <span className="flex items-center gap-1.5"><Clock size={13} className="text-gold" /> {formatDubaiDateTime(gathering.startAt, 'short')}</span>
              <span className="flex items-center gap-1.5"><MapPin size={13} className="text-gold" /> {gathering.locationName}</span>
              <span className="flex items-center gap-1.5"><Users size={13} className="text-gold" /> {gathering.invitations.length} invited</span>
            </div>
            {gathering.notes ? <p className="mt-4 border-l-2 border-gold pl-3 text-xs italic text-ink/55">{gathering.notes}</p> : null}
            {gathering.invitations.length > 0 ? (
              <div className="mt-5 grid gap-2 border-t border-sepia/50 pt-4 sm:grid-cols-2">
                {gathering.invitations.map(invitation => (
                  <div key={invitation.id} className="flex items-center justify-between rounded-xl border border-sepia/60 p-3"><span className="text-xs font-semibold">{invitation.memberName}</span><StatusPill status={invitation.status} /></div>
                ))}
              </div>
            ) : <p className="mt-4 text-xs text-ink/40">No invitation links have been prepared.</p>}
          </article>
        ))}
      </section>

      <section className="relative overflow-hidden rounded-[2rem] bg-ink p-7 text-white shadow-xl">
        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/45">Next persisted gathering</p>
        <p className="mt-2 font-serif text-2xl font-bold italic">{nextGathering?.title ?? 'Nothing upcoming yet'}</p>
        <p className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gold"><Clock size={12} /> {nextGathering ? formatDubaiDateTime(nextGathering.startAt) : 'Create a gathering to add it here'}</p>
      </section>

      <AnimatePresence>
        {plannerOpen ? (
          <ModalShell title={plannerStage === 'details' ? 'Plan a gathering' : plannerStage === 'review' ? 'Review before saving' : 'Invitation links'} onClose={closePlanner}>
            {plannerStage === 'details' ? (
              <form onSubmit={reviewDraft} className="flex min-h-0 flex-1 flex-col">
                <div className="space-y-4 overflow-y-auto p-6 text-sm">
                  <div className="rounded-xl border border-sepia bg-sand/30 p-3 text-xs text-ink/60"><Info size={13} className="mr-1 inline text-gold" /> {plannerSourcePlanTitle ? `Prefilled from the stored plan “${plannerSourcePlanTitle}”. This is editable and nothing is saved or shared until you review and confirm.` : 'Nothing is saved or shared until you review and confirm.'}</div>
                  <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Title</span><input required minLength={2} maxLength={120} value={draft.title} onChange={event => updateDraft('title', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5 outline-none focus:border-gold" placeholder="Friday family dinner" /></label>
                  <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Purpose</span><input required minLength={2} maxLength={500} value={draft.purpose} onChange={event => updateDraft('purpose', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5 outline-none focus:border-gold" placeholder="Reconnect after a busy month" /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Date</span><input required type="date" value={draft.date} onChange={event => updateDraft('date', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-3 py-2.5" /></label>
                    <label><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Dubai time</span><input required type="time" value={draft.time} onChange={event => updateDraft('time', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-3 py-2.5" /></label>
                  </div>
                  <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Location</span><input required minLength={2} maxLength={300} value={draft.locationName} onChange={event => updateDraft('locationName', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5" placeholder="Family home, Abu Dhabi" /></label>
                  <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Type</span><select value={draft.type} onChange={event => updateDraft('type', event.target.value)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5"><option>Family gathering</option><option>Majlis</option><option>Meal</option><option>Outdoor activity</option><option>Celebration</option><option>Visit</option><option>Phone call</option><option>Video call</option></select></label>
                  <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Notes (optional)</span><textarea maxLength={2000} rows={2} value={draft.notes} onChange={event => updateDraft('notes', event.target.value)} className="w-full resize-none rounded-xl border border-sepia bg-sand/20 px-4 py-2.5" placeholder="Accessibility, food, or arrival details" /></label>
                  <div><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">People to invite (optional)</span><MemberPicker members={members} selected={draft.memberIds} onToggle={toggleDraftMember} /></div>
                  {draft.memberIds.length > 0 ? <label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Sharing option</span><select value={draft.channel} onChange={event => updateDraft('channel', event.target.value as InvitationChannel)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5"><option value="share_link">Copyable links</option><option value="whatsapp">WhatsApp share buttons</option></select></label> : null}
                  {saveError ? <p role="alert" className="text-xs text-red-700">{saveError}</p> : null}
                </div>
                <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4"><button type="button" onClick={closePlanner} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Cancel</button><button type="submit" className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold">Review</button></footer>
              </form>
            ) : plannerStage === 'review' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="space-y-4 overflow-y-auto p-6">
                  <div className="rounded-2xl border border-sepia p-5"><h4 className="font-serif text-xl font-bold italic">{draft.title}</h4><p className="mt-1 text-xs text-ink/55">{draft.purpose}</p><div className="mt-4 space-y-2 text-xs"><p className="flex items-center gap-2"><Clock size={14} className="text-gold" /> {formatDubaiDateTime(toDubaiIso(draft.date, draft.time))}</p><p className="flex items-center gap-2"><MapPin size={14} className="text-gold" /> {draft.locationName}</p><p className="flex items-center gap-2"><Users size={14} className="text-gold" /> {draft.memberIds.length ? `${draft.memberIds.length} private RSVP link${draft.memberIds.length === 1 ? '' : 's'} will be prepared` : 'Saved as a draft with no links'}</p></div></div>
                  {draft.memberIds.length > 0 ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><p className="font-bold">Confirmation required</p><p className="mt-1">Confirming creates the gathering and private links. It does not send a message. You choose which links to copy or open in WhatsApp afterward.</p></div> : null}
                  {saveError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{saveError}</p> : null}
                </div>
                <footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4"><button type="button" disabled={saving || Boolean(savedGathering)} onClick={() => setPlannerStage('details')} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider disabled:opacity-40">Back</button><button type="button" disabled={saving} onClick={() => void saveAndPrepare()} className="flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />}{savedGathering ? 'Retry link preparation' : draft.memberIds.length ? 'Create & prepare links' : 'Create draft'}</button></footer>
              </div>
            ) : savedGathering && prepared ? (
              <div className="flex min-h-0 flex-1 flex-col"><div className="overflow-y-auto p-6"><PreparedLinks invitations={prepared.invitations} gathering={savedGathering} deliveryNotice={prepared.deliveryNotice} /></div><footer className="flex justify-end border-t border-sepia bg-sand px-6 py-4"><button type="button" onClick={closePlanner} className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white">Done</button></footer></div>
            ) : null}
          </ModalShell>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {inviteTarget ? (
          <ModalShell title={inviteStage === 'choose' ? `Invite to ${inviteTarget.title}` : inviteStage === 'review' ? 'Review link preparation' : 'Invitation links'} onClose={closeInviteModal}>
            {inviteStage === 'choose' ? (
              <div className="flex min-h-0 flex-1 flex-col"><div className="space-y-4 overflow-y-auto p-6"><p className="text-xs text-ink/60">Select people who should receive a new private RSVP link. Preparing again replaces an existing link for that person.</p><MemberPicker members={members} selected={inviteMemberIds} onToggle={id => setInviteMemberIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])} /><label className="block"><span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Sharing option</span><select value={inviteChannel} onChange={event => setInviteChannel(event.target.value as InvitationChannel)} className="w-full rounded-xl border border-sepia bg-sand/20 px-4 py-2.5"><option value="share_link">Copyable links</option><option value="whatsapp">WhatsApp share buttons</option></select></label></div><footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4"><button type="button" onClick={closeInviteModal} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Cancel</button><button type="button" disabled={inviteMemberIds.length === 0} onClick={() => setInviteStage('review')} className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white disabled:opacity-40">Review</button></footer></div>
            ) : inviteStage === 'review' ? (
              <div className="flex min-h-0 flex-1 flex-col"><div className="space-y-4 overflow-y-auto p-6"><div className="rounded-2xl border border-sepia p-5"><h4 className="font-serif text-lg font-bold italic">{inviteTarget.title}</h4><p className="mt-3 flex items-center gap-2 text-xs"><Users size={14} className="text-gold" /> Prepare {inviteMemberIds.length} private RSVP link{inviteMemberIds.length === 1 ? '' : 's'}</p><p className="mt-2 flex items-center gap-2 text-xs"><Send size={14} className="text-gold" /> {inviteChannel === 'whatsapp' ? 'WhatsApp buttons will open a prefilled message' : 'Copyable links will be shown'}</p></div><div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><strong>No automatic delivery.</strong> Confirming prepares links only.</div>{inviteError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{inviteError}</p> : null}</div><footer className="flex justify-end gap-3 border-t border-sepia bg-sand px-6 py-4"><button type="button" disabled={inviteBusy} onClick={() => setInviteStage('choose')} className="px-4 py-2 text-[9px] font-bold uppercase tracking-wider">Back</button><button type="button" disabled={inviteBusy} onClick={() => void prepareExistingInvitations()} className="flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white disabled:opacity-50">{inviteBusy ? <LoaderCircle className="animate-spin" size={13} /> : <Link2 size={13} />} Confirm & prepare</button></footer></div>
            ) : invitePrepared ? (
              <div className="flex min-h-0 flex-1 flex-col"><div className="overflow-y-auto p-6"><PreparedLinks invitations={invitePrepared.invitations} gathering={invitePrepared.gathering} deliveryNotice={invitePrepared.deliveryNotice} /></div><footer className="flex justify-end border-t border-sepia bg-sand px-6 py-4"><button type="button" onClick={closeInviteModal} className="rounded-xl bg-ink px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-white">Done</button></footer></div>
            ) : null}
          </ModalShell>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
