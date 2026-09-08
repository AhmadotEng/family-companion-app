import { ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Plus,
  RefreshCw,
  Rows3,
  Send,
  Users,
  X,
} from 'lucide-react';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError } from '../api/client';
import { engagementApi } from '../api/engagement';
import type { GatheringPlanPrefill } from '../api/reconnectionPlans';
import { GatheringPlanner, type GatheringPlannerStage } from '../components/GatheringPlanner';
import type { PersistentGathering, PreparedInvitation, RsvpStatus } from '../engagementTypes';
import { absoluteInvitationUrl } from '../lib/agentInvitationLinks';
import { dubaiTodayKey, formatDubaiDateKey, formatDubaiDateTime } from '../lib/gatheringDate';
import { createGatheringPlannerIdempotencyKey } from '../lib/gatheringPlanner';
import {
  clearManualGatheringRetryState,
  readManualGatheringRetryState,
  writeManualGatheringRetryState,
} from '../lib/manualGatheringRetry';
import { useModalFocusTrap } from '../lib/modalFocus';
import { cn } from '../lib/utils';
import { useLanguage } from '../i18n';
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
  focusTarget?: CalendarFocusTarget | null;
}

export interface CalendarFocusTarget {
  familyId: string;
  gatheringId?: string;
  startAt: string;
}

type CalendarViewMode = 'agenda' | 'month';

const mobileCalendarQuery = '(max-width: 767px)';

function prefersMobileAgenda(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(mobileCalendarQuery).matches;
}

interface ActivePlanner {
  familyId: string;
  currentUserId?: string;
  requestVersion: number;
  idempotencyKey: string;
  uncertainCreateOutcome?: boolean;
  prefill?: GatheringPlanPrefill;
  source: 'manual' | 'reconnection';
  sourceLabel?: string;
  defaultDate?: string;
  defaultTime?: string;
}

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
      'rounded-full px-2.5 py-1 text-[10px] font-semibold',
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
  deliveryNotice,
}: {
  invitations: PreparedInvitation[];
  deliveryNotice: string;
}) {
  const [copiedMemberId, setCopiedMemberId] = useState('');
  const [copyError, setCopyError] = useState('');

  const copyLink = async (invitation: PreparedInvitation, invitationUrl: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopiedMemberId(invitation.memberId);
      window.setTimeout(() => setCopiedMemberId(''), 1800);
    } catch {
      setCopyError('The browser blocked clipboard access. Open the link and copy it from the address bar.');
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
        <p className="font-bold flex items-center gap-2"><Info size={14} /> Links prepared, not sent</p>
        <p className="mt-1 leading-relaxed">{deliveryNotice}</p>
        <p className="mt-2 font-medium">Family members who use AILAH will also receive an in-app RSVP notification.</p>
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
                    <button type="button" onClick={() => void copyLink(invitation, invitationUrl)} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-gold-ink">
                      {copiedMemberId === invitation.memberId ? <Check size={12} /> : <Copy size={12} />}
                      {copiedMemberId === invitation.memberId ? 'Copied' : 'Copy link'}
                    </button>
                    <a href={invitationUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1.5 rounded-lg border border-sepia px-3 text-xs font-semibold hover:border-gold">
                      <ExternalLink size={12} /> Preview
                    </a>
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

function MemberPicker({ members, selected, onToggle }: { members: FamilyMember[]; selected: string[]; onToggle: (id: string) => void }) {
  if (members.length === 0) {
    return <p className="rounded-xl border border-dashed border-sepia p-4 text-xs text-ink/65">Add family members to the Family Tree before preparing invitation links.</p>;
  }
  return (
    <div className="grid max-h-[40dvh] grid-cols-1 gap-2 overflow-y-auto rounded-2xl border border-sepia/60 bg-sand/10 p-2 sm:max-h-44 sm:grid-cols-2 sm:p-3">
      {members.map(member => (
        <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl p-2 hover:bg-sand/50">
          <input type="checkbox" checked={selected.includes(member.id)} onChange={() => onToggle(member.id)} className="accent-[#b88a44]" />
          {member.photo ? <img src={member.photo} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sepia/30 text-[10px] font-bold">{member.name.slice(0, 1)}</span>}
          <span className="truncate text-xs font-semibold">{member.name}</span>
        </label>
      ))}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  closeDisabled = false,
  scrollRoot,
  children,
}: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  scrollRoot?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialogRef = useModalFocusTrap<HTMLDivElement>({
    active: true,
    onEscape: onClose,
    escapeDisabled: closeDisabled,
    scrollRoot,
  });

  const modal = (
    <div ref={dialogRef} tabIndex={-1} className="mobile-sheet-overlay fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-0 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.99 }}
        transition={{ duration: 0.18 }}
        className="mobile-sheet-surface flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden border-sepia bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-[2rem] sm:border"
      >
        <header className="mobile-sheet-header flex min-h-14 shrink-0 items-center justify-between border-b border-sepia bg-sand px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-5">
          <h3 className="font-serif text-lg font-bold text-ink sm:text-xl">{title}</h3>
          <button type="button" onClick={onClose} disabled={closeDisabled} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-sepia/30 disabled:opacity-40" aria-label="Close"><X size={20} /></button>
        </header>
        {children}
      </motion.section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
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
  focusTarget,
}: CalendarProps) {
  const { language } = useLanguage();
  const dateLocale = language === 'ar' ? arSA : enUS;
  const todayKey = dubaiTodayKey();
  const [currentMonth, setCurrentMonth] = useState(() => dateFromKey(todayKey));
  const [selectedDate, setSelectedDate] = useState(() => dateFromKey(todayKey));
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => prefersMobileAgenda() ? 'agenda' : 'month');
  const [gatherings, setGatherings] = useState<PersistentGathering[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activePlanner, setActivePlanner] = useState<ActivePlanner | null>(null);
  const [plannerStage, setPlannerStage] = useState<GatheringPlannerStage>('details');
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<PersistentGathering | null>(null);
  const [inviteStage, setInviteStage] = useState<'choose' | 'review' | 'links'>('choose');
  const [inviteMemberIds, setInviteMemberIds] = useState<string[]>([]);
  const inviteChannel = 'share_link' as const;
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invitePrepared, setInvitePrepared] = useState<{ invitations: PreparedInvitation[]; deliveryNotice: string; gathering: PersistentGathering } | null>(null);
  const [completionBusyId, setCompletionBusyId] = useState('');
  const [operationMessage, setOperationMessage] = useState('');
  const [operationError, setOperationError] = useState('');
  const modalScrollRootRef = useRef<HTMLElement>(null);
  const activeFamilyIdRef = useRef(familyId);
  const viewModeExplicitRef = useRef(false);
  const mountedRef = useRef(false);
  const loadRequestVersionRef = useRef(0);
  const plannerRequestVersionRef = useRef(0);
  const invitationRequestVersionRef = useRef(0);
  const completionRequestVersionRef = useRef(0);
  const manualPlannerRetryRef = useRef<{
    familyId: string;
    currentUserId?: string;
    idempotencyKey: string;
    uncertainCreateOutcome: boolean;
  } | null>(null);
  const manualPlannerScopeRef = useRef<{ familyId: string; currentUserId: string } | null>(null);
  const confirmedPlannerKeysRef = useRef(new Set<string>());
  activeFamilyIdRef.current = familyId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestVersionRef.current += 1;
      plannerRequestVersionRef.current += 1;
      invitationRequestVersionRef.current += 1;
      completionRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(mobileCalendarQuery);
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (!viewModeExplicitRef.current) setViewMode(event.matches ? 'agenda' : 'month');
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleBreakpointChange);
      return () => mediaQuery.removeEventListener('change', handleBreakpointChange);
    }
    mediaQuery.addListener(handleBreakpointChange);
    return () => mediaQuery.removeListener(handleBreakpointChange);
  }, []);

  const publishGatherings = useCallback((next: PersistentGathering[]) => {
    setGatherings(next);
    onGatheringsChanged?.(next);
  }, [onGatheringsChanged]);

  const upsertGathering = useCallback((gathering: PersistentGathering) => {
    if (!mountedRef.current || activeFamilyIdRef.current !== familyId || gathering.familyId !== familyId) return;
    publishGatherings(
      [...gatherings.filter(item => item.id !== gathering.id), gathering]
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    );
    const gatheringDate = dateFromKey(formatDubaiDateKey(gathering.startAt));
    setSelectedDate(gatheringDate);
    setCurrentMonth(gatheringDate);
  }, [familyId, gatherings, publishGatherings]);

  const loadGatherings = useCallback(async () => {
    if (!familyId) return;
    const requestedFamilyId = familyId;
    const requestVersion = ++loadRequestVersionRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await engagementApi.listGatherings(requestedFamilyId);
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      publishGatherings(result.gatherings);
    } catch (caught) {
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      setLoadError(errorMessage(caught, 'Unable to load family gatherings.'));
    } finally {
      if (
        mountedRef.current
        && activeFamilyIdRef.current === requestedFamilyId
        && loadRequestVersionRef.current === requestVersion
      ) setLoading(false);
    }
  }, [familyId, publishGatherings]);

  useEffect(() => {
    loadRequestVersionRef.current += 1;
    plannerRequestVersionRef.current += 1;
    invitationRequestVersionRef.current += 1;
    completionRequestVersionRef.current += 1;
    const previousScope = manualPlannerScopeRef.current;
    const nextScope = currentUserId && familyId ? { familyId, currentUserId } : null;
    if (
      previousScope
      && (!nextScope
        || previousScope.familyId !== nextScope.familyId
        || previousScope.currentUserId !== nextScope.currentUserId)
    ) {
      clearManualGatheringRetryState(previousScope.currentUserId, previousScope.familyId);
    }
    manualPlannerScopeRef.current = nextScope;
    const storedRetry = nextScope
      ? readManualGatheringRetryState(nextScope.currentUserId, nextScope.familyId)
      : null;
    manualPlannerRetryRef.current = storedRetry && nextScope ? {
      ...nextScope,
      idempotencyKey: storedRetry.idempotencyKey,
      uncertainCreateOutcome: true,
    } : null;
    confirmedPlannerKeysRef.current.clear();
    setGatherings([]);
    setLoading(Boolean(familyId));
    setLoadError('');
    setActivePlanner(null);
    setPlannerStage('details');
    setPlannerBusy(false);
    setInviteTarget(null);
    setInviteStage('choose');
    setInviteMemberIds([]);
    setInviteBusy(false);
    setInviteError('');
    setInvitePrepared(null);
    setCompletionBusyId('');
    setOperationMessage('');
    setOperationError('');
  }, [currentUserId, familyId]);

  useEffect(() => { void loadGatherings(); }, [loadGatherings, refreshVersion]);

  useEffect(() => {
    if (!focusTarget || focusTarget.familyId !== familyId) return;
    const dateKey = formatDubaiDateKey(focusTarget.startAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const focusedDate = dateFromKey(dateKey);
    setSelectedDate(focusedDate);
    setCurrentMonth(focusedDate);
  }, [familyId, focusTarget]);

  useEffect(() => {
    if (!planPrefill) return;
    const requestVersion = ++plannerRequestVersionRef.current;
    setPlannerStage('details');
    setActivePlanner({
      familyId,
      requestVersion,
      idempotencyKey: createGatheringPlannerIdempotencyKey(),
      prefill: planPrefill,
      source: 'reconnection',
      sourceLabel: planPrefill.sourcePlanTitle,
    });
    onPlanPrefillConsumed?.();
  }, [onPlanPrefillConsumed, planPrefill]);

  const startDate = startOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: startDate, end: endOfMonth(currentMonth) });
  const selectedKey = format(selectedDate, 'yyyy-MM-dd');
  const weekDays = useMemo(() => {
    const firstDay = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: firstDay, end: addDays(firstDay, 6) });
  }, [selectedDate]);
  const scopedGatherings = useMemo(
    () => gatherings.filter(gathering => gathering.familyId === familyId),
    [familyId, gatherings],
  );
  const selectedGatherings = scopedGatherings.filter(gathering => formatDubaiDateKey(gathering.startAt) === selectedKey);
  useEffect(() => {
    if (!focusTarget?.gatheringId || focusTarget.familyId !== familyId) return;
    if (!selectedGatherings.some(gathering => gathering.id === focusTarget.gatheringId)) return;
    const card = document.querySelector<HTMLElement>(`[data-gathering-id="${focusTarget.gatheringId}"]`);
    card?.focus({ preventScroll: true });
  }, [familyId, focusTarget, gatherings, selectedKey]);
  const upcomingGatherings = useMemo(() => scopedGatherings
    .filter(gathering => new Date(gathering.startAt).getTime() >= Date.now() && gathering.status !== 'cancelled')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()), [scopedGatherings]);
  const nextGathering = upcomingGatherings[0];
  const laterUpcomingGatherings = upcomingGatherings
    .filter(gathering => formatDubaiDateKey(gathering.startAt) !== selectedKey)
    .slice(0, 3);

  const selectDate = (date: Date) => {
    setSelectedDate(date);
    setCurrentMonth(date);
  };

  const movePeriod = (direction: -1 | 1) => {
    if (viewMode === 'agenda') {
      selectDate(addDays(selectedDate, direction * 7));
      return;
    }
    setCurrentMonth(direction < 0 ? subMonths(currentMonth, 1) : addMonths(currentMonth, 1));
  };

  const selectToday = () => selectDate(dateFromKey(todayKey));

  const openPlanner = (dateKey = selectedKey) => {
    const requestVersion = ++plannerRequestVersionRef.current;
    const retainedRetry = manualPlannerRetryRef.current?.familyId === familyId
      && manualPlannerRetryRef.current.currentUserId === currentUserId
      ? manualPlannerRetryRef.current
      : undefined;
    const idempotencyKey = retainedRetry?.idempotencyKey ?? createGatheringPlannerIdempotencyKey();
    const uncertainCreateOutcome = retainedRetry?.uncertainCreateOutcome ?? false;
    manualPlannerRetryRef.current = {
      familyId,
      currentUserId,
      idempotencyKey,
      uncertainCreateOutcome,
    };
    setPlannerStage('details');
    setActivePlanner({
      familyId,
      currentUserId,
      requestVersion,
      idempotencyKey,
      uncertainCreateOutcome,
      source: 'manual',
      defaultDate: dateKey,
      defaultTime: '18:30',
    });
  };
  const closePlanner = () => {
    if (plannerBusy) return;
    if (activePlanner?.source === 'manual') {
      if (confirmedPlannerKeysRef.current.has(activePlanner.idempotencyKey)) {
        confirmedPlannerKeysRef.current.delete(activePlanner.idempotencyKey);
        if (manualPlannerRetryRef.current?.idempotencyKey === activePlanner.idempotencyKey) {
          manualPlannerRetryRef.current = null;
        }
        if (activePlanner.currentUserId) {
          clearManualGatheringRetryState(activePlanner.currentUserId, activePlanner.familyId);
        }
      } else if (activePlanner.uncertainCreateOutcome) {
        manualPlannerRetryRef.current = {
          familyId: activePlanner.familyId,
          currentUserId: activePlanner.currentUserId,
          idempotencyKey: activePlanner.idempotencyKey,
          uncertainCreateOutcome: true,
        };
        if (activePlanner.currentUserId) {
          writeManualGatheringRetryState(
            activePlanner.currentUserId,
            activePlanner.familyId,
            activePlanner.idempotencyKey,
          );
        }
      } else {
        manualPlannerRetryRef.current = null;
        if (activePlanner.currentUserId) {
          clearManualGatheringRetryState(activePlanner.currentUserId, activePlanner.familyId);
        }
      }
    }
    plannerRequestVersionRef.current += 1;
    setActivePlanner(null);
    setPlannerStage('details');
  };

  const discardUncertainManualRetry = () => {
    if (plannerBusy || activePlanner?.source !== 'manual' || !activePlanner.uncertainCreateOutcome) return;
    if (!window.confirm('Start a separate gathering draft? The previous request may already have created a gathering. Check this Calendar before creating another one.')) return;
    confirmedPlannerKeysRef.current.delete(activePlanner.idempotencyKey);
    manualPlannerRetryRef.current = null;
    if (activePlanner.currentUserId) {
      clearManualGatheringRetryState(activePlanner.currentUserId, activePlanner.familyId);
    }
    const requestVersion = ++plannerRequestVersionRef.current;
    setPlannerStage('details');
    setActivePlanner({
      ...activePlanner,
      requestVersion,
      idempotencyKey: createGatheringPlannerIdempotencyKey(),
      uncertainCreateOutcome: false,
    });
  };

  const canManageGathering = (gathering: PersistentGathering) => (
    familyRole === 'owner' || familyRole === 'admin' || gathering.createdByUserId === currentUserId
  );
  const canCompleteGathering = familyRole === 'owner' || familyRole === 'admin';

  const openInviteModal = (gathering: PersistentGathering) => {
    invitationRequestVersionRef.current += 1;
    setInviteTarget(gathering);
    setInviteMemberIds([]);
    setInviteStage('choose');
    setInviteError('');
    setInvitePrepared(null);
  };
  const closeInviteModal = () => {
    if (inviteBusy) return;
    invitationRequestVersionRef.current += 1;
    setInviteTarget(null);
    setInvitePrepared(null);
  };
  const prepareExistingInvitations = async () => {
    if (!inviteTarget || inviteMemberIds.length === 0) return;
    const requestedFamilyId = familyId;
    const requestVersion = ++invitationRequestVersionRef.current;
    setInviteBusy(true);
    setInviteError('');
    try {
      const result = await engagementApi.prepareInvitations(inviteTarget.id, { memberIds: inviteMemberIds, channel: inviteChannel });
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || invitationRequestVersionRef.current !== requestVersion
        || result.gathering.familyId !== requestedFamilyId
      ) return;
      setInvitePrepared(result);
      setInviteTarget(result.gathering);
      setInviteStage('links');
      publishGatherings(gatherings.map(item => item.id === result.gathering.id ? result.gathering : item));
    } catch (caught) {
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || invitationRequestVersionRef.current !== requestVersion
      ) return;
      setInviteError(errorMessage(caught, 'Unable to prepare invitation links.'));
    } finally {
      if (
        mountedRef.current
        && activeFamilyIdRef.current === requestedFamilyId
        && invitationRequestVersionRef.current === requestVersion
      ) setInviteBusy(false);
    }
  };

  const completeGathering = async (gathering: PersistentGathering) => {
    const attendees = gathering.invitations.filter(invitation => invitation.status === 'going');
    if (attendees.length < 2) {
      setOperationError('At least two invitees must RSVP Going before completion can be verified.');
      return;
    }
    if (!confirm(`Mark “${gathering.title}” completed with ${attendees.length} confirmed attendees?`)) return;
    const requestedFamilyId = familyId;
    const requestVersion = ++completionRequestVersionRef.current;
    setCompletionBusyId(gathering.id);
    setOperationError('');
    setOperationMessage('');
    try {
      const result = await engagementApi.completeGathering(gathering.id, attendees.map(invitation => invitation.memberId));
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || completionRequestVersionRef.current !== requestVersion
        || result.gathering.familyId !== requestedFamilyId
      ) return;
      publishGatherings(gatherings.map(item => item.id === result.gathering.id ? result.gathering : item));
      setOperationMessage(`Gathering completed. ${result.pointsAwarded} verified family points were added.`);
    } catch (caught) {
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || completionRequestVersionRef.current !== requestVersion
      ) return;
      setOperationError(errorMessage(caught, 'The gathering could not be completed.'));
    } finally {
      if (
        mountedRef.current
        && activeFamilyIdRef.current === requestedFamilyId
        && completionRequestVersionRef.current === requestVersion
      ) setCompletionBusyId('');
    }
  };

  return (
    <div
      ref={(element: HTMLDivElement | null) => {
        modalScrollRootRef.current = element?.closest<HTMLElement>('main') ?? null;
      }}
      className="space-y-4 pb-24 sm:space-y-8 sm:pb-0"
      data-calendar-view={viewMode}
    >
      <section className="relative overflow-hidden rounded-3xl bg-ink p-5 text-white shadow-xl sm:rounded-[2rem] sm:p-8">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md">
            <p className="text-xs font-semibold text-gold">Create gathering</p>
            <h3 className="mt-2 font-serif text-2xl font-bold sm:text-3xl">Bring everyone together</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/75">Create a gathering, choose who to invite, and track RSVPs in one place.</p>
          </div>
          <button type="button" onClick={() => openPlanner()} className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-gold px-6 text-sm font-bold text-ink shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Plus size={18} /> Plan a gathering
          </button>
        </div>
        <CalendarIcon className="absolute -bottom-8 -right-6 size-36 text-white/5" aria-hidden="true" />
      </section>

      <header className="flex flex-col gap-3 border-b border-sepia pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pb-4">
        <div>
          <p className="text-xs font-semibold text-gold-ink">Asia/Dubai timezone</p>
          <h2 className="font-serif text-2xl font-bold text-ink sm:text-3xl">
            {format(viewMode === 'agenda' ? selectedDate : currentMonth, 'MMMM yyyy', { locale: dateLocale })}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
          <div className="flex rounded-xl border border-sepia bg-white p-1" role="group" aria-label="Calendar view">
            <button
              type="button"
              aria-pressed={viewMode === 'agenda'}
              onClick={() => {
                viewModeExplicitRef.current = true;
                setViewMode('agenda');
              }}
              className={cn('flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold', viewMode === 'agenda' ? 'bg-ink text-white' : 'text-ink/55 hover:bg-sand')}
            >
              <Rows3 size={15} /> Agenda
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'month'}
              onClick={() => {
                viewModeExplicitRef.current = true;
                setCurrentMonth(selectedDate);
                setViewMode('month');
              }}
              className={cn('flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold', viewMode === 'month' ? 'bg-ink text-white' : 'text-ink/55 hover:bg-sand')}
            >
              <CalendarIcon size={15} /> Month
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => movePeriod(-1)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-sand" aria-label={viewMode === 'agenda' ? 'Previous week' : 'Previous month'}><ChevronLeft size={20} /></button>
            <button onClick={selectToday} className="min-h-11 rounded-full px-3 text-xs font-semibold hover:bg-sand">Today</button>
            <button onClick={() => movePeriod(1)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-sand" aria-label={viewMode === 'agenda' ? 'Next week' : 'Next month'}><ChevronRight size={20} /></button>
          </div>
        </div>
      </header>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{loadError}</span>
          <button onClick={() => void loadGatherings()} className="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : null}
      {operationError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{operationError}</div> : null}
      {operationMessage ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{operationMessage}</div> : null}

      {viewMode === 'agenda' ? (
        <section className="rounded-2xl border border-sepia bg-white p-1 shadow-sm" aria-label="Gathering week">
          <div className="flex gap-px">
            {weekDays.map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const count = scopedGatherings.filter(item => formatDubaiDateKey(item.startAt) === key).length;
              const selected = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectDate(day)}
                  className={cn(
                    'relative flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center rounded-xl text-xs transition-colors',
                    selected ? 'bg-ink text-white shadow-sm' : 'text-ink/55 hover:bg-sand',
                    key === todayKey && !selected && 'text-gold-ink ring-1 ring-inset ring-gold-ink/50',
                  )}
                  aria-label={`${format(day, 'EEEE, MMMM d', { locale: dateLocale })}${count ? `, ${count} gatherings` : ''}`}
                  aria-pressed={selected}
                  aria-current={key === todayKey ? 'date' : undefined}
                >
                  <span className="text-[10px] font-medium">{format(day, 'EEEEE', { locale: dateLocale })}</span>
                  <span className="mt-0.5 font-bold">{format(day, 'd')}</span>
                  {count > 0 ? <span className={cn('absolute bottom-1 h-1 w-1 rounded-full', selected ? 'bg-white' : 'bg-gold')} /> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-sepia bg-white p-1 shadow-sm sm:rounded-[2rem] sm:p-6" aria-label="Gathering calendar">
          <div className="grid grid-cols-7 gap-px sm:gap-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <div key={day} className="py-1.5 text-center text-[10px] font-semibold text-ink/40 sm:py-2">{day}</div>)}
            {Array.from({ length: startDate.getDay() }).map((_, index) => <div key={`blank-${index}`} />)}
            {days.map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const count = scopedGatherings.filter(item => formatDubaiDateKey(item.startAt) === key).length;
              const selected = key === selectedKey;
              return (
                <button key={key} onClick={() => selectDate(day)} className={cn('relative flex min-h-11 min-w-11 flex-col items-center justify-center rounded-xl text-xs font-bold transition-all sm:h-14 sm:rounded-2xl', selected ? 'bg-ink text-white shadow-md' : 'hover:bg-sand/60', key === todayKey && !selected && 'border border-gold-ink text-gold-ink')} aria-label={`${format(day, 'MMMM d', { locale: dateLocale })}${count ? `, ${count} gatherings` : ''}`} aria-pressed={selected} aria-current={key === todayKey ? 'date' : undefined}>
                  {format(day, 'd')}
                  {count > 0 ? <span className={cn('mt-1 h-1.5 w-1.5 rounded-full', selected ? 'bg-white' : 'bg-gold')} /> : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-label="Gatherings for selected date">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sepia pb-3 sm:pb-4">
          <div>
            <p className="text-xs font-medium text-ink/45">Selected date</p>
            <h3 className="font-serif text-xl text-ink sm:text-2xl">{format(selectedDate, 'do MMMM', { locale: dateLocale })}</h3>
          </div>
          <button
            onClick={() => openPlanner()}
            className="flex min-h-11 items-center gap-2 rounded-full border border-sepia bg-white px-4 text-xs font-bold text-ink shadow-sm transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
          >
            <Plus size={17} /> Plan gathering
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-sepia bg-white p-6 text-sm text-ink/55 sm:rounded-[2rem] sm:p-10"><LoaderCircle className="animate-spin text-gold" size={20} /> Loading gatherings…</div>
        ) : selectedGatherings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sepia bg-white/50 p-6 text-center sm:rounded-[2rem] sm:p-10">
            <CalendarIcon className="mx-auto text-gold" size={24} />
            <p className="mt-3 font-serif text-lg text-ink/50">No gathering planned for this day.</p>
          </div>
        ) : selectedGatherings.map(gathering => (
          <article
            key={gathering.id}
            data-gathering-id={gathering.id}
            tabIndex={focusTarget?.familyId === familyId && focusTarget.gatheringId === gathering.id ? -1 : undefined}
            className={cn(
              'rounded-2xl border bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6',
              focusTarget?.familyId === familyId && focusTarget.gatheringId === gathering.id
                ? 'border-gold ring-2 ring-gold/20'
                : 'border-sepia',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h4 className="font-serif text-xl font-bold">{gathering.title}</h4><StatusPill status={gathering.status} /></div>
                <p className="mt-1 text-xs text-ink/55">{gathering.purpose}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManageGathering(gathering) && gathering.status !== 'completed' && gathering.status !== 'cancelled' ? (
                  <button onClick={() => openInviteModal(gathering)} className="flex min-h-11 items-center gap-2 rounded-xl border border-sepia px-3 text-xs font-semibold hover:border-gold"><Link2 size={13} /> Prepare RSVP links</button>
                ) : null}
                {canCompleteGathering && gathering.status === 'inviting' && new Date(gathering.startAt).getTime() <= Date.now() ? (
                  <button disabled={Boolean(completionBusyId)} onClick={() => void completeGathering(gathering)} className="flex min-h-11 items-center gap-2 rounded-xl bg-ink px-3 text-xs font-semibold text-white hover:bg-gold-ink disabled:opacity-40">
                    {completionBusyId === gathering.id ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />} Complete
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-medium text-ink/50 sm:gap-4">
              <span className="flex items-center gap-1.5"><Clock size={13} className="text-gold" /> {formatDubaiDateTime(gathering.startAt, 'short')}</span>
              <span className="flex items-center gap-1.5"><MapPin size={13} className="text-gold" /> {gathering.locationName}</span>
              <span className="flex items-center gap-1.5"><Users size={13} className="text-gold" /> {gathering.invitations.length} invited</span>
            </div>
            {gathering.notes ? <p className="mt-4 border-l-2 border-gold pl-3 text-xs text-ink/55">{gathering.notes}</p> : null}
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

      {viewMode === 'agenda' ? (
        <section className="space-y-2" aria-label="Upcoming gatherings">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-bold">Coming up</h3>
            <span className="text-xs text-ink/45">Next {laterUpcomingGatherings.length}</span>
          </div>
          {laterUpcomingGatherings.length > 0 ? laterUpcomingGatherings.map(gathering => (
            <button
              key={gathering.id}
              type="button"
              onClick={() => selectDate(dateFromKey(formatDubaiDateKey(gathering.startAt)))}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-sepia bg-white px-4 py-3 text-left shadow-sm hover:border-gold"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{gathering.title}</span>
                <span className="mt-0.5 block truncate text-xs text-ink/50">{gathering.locationName}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-gold-ink">{formatDubaiDateTime(gathering.startAt, 'short')}</span>
            </button>
          )) : (
            <p className="rounded-2xl border border-dashed border-sepia bg-white/40 p-4 text-sm text-ink/50">No later gatherings are scheduled.</p>
          )}
        </section>
      ) : (
        <section className="relative overflow-hidden rounded-[2rem] bg-ink p-7 text-white shadow-xl">
          <p className="text-xs font-semibold text-white/50">Next persisted gathering</p>
          <p className="mt-2 font-serif text-2xl font-bold">{nextGathering?.title ?? 'Nothing upcoming yet'}</p>
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-gold"><Clock size={12} /> {nextGathering ? formatDubaiDateTime(nextGathering.startAt) : 'Create a gathering to add it here'}</p>
        </section>
      )}

      <AnimatePresence>
        {activePlanner && activePlanner.familyId === familyId ? (
          <ModalShell
            title={plannerStage === 'details'
              ? 'Plan a gathering'
              : plannerStage === 'review'
                ? 'Review before saving'
                : plannerStage === 'links'
                  ? 'Invitation links'
                  : 'Gathering saved'}
            onClose={closePlanner}
            closeDisabled={plannerBusy}
            scrollRoot={modalScrollRootRef}
          >
            <div key={activePlanner.idempotencyKey} className="contents">
              <GatheringPlanner
              familyId={familyId}
              members={members}
              prefill={activePlanner.prefill}
              source={activePlanner.source}
              idempotencyKey={activePlanner.idempotencyKey}
              initialCreateOutcomeUncertain={Boolean(activePlanner.uncertainCreateOutcome)}
              sourceLabel={activePlanner.sourceLabel}
              defaultDate={activePlanner.defaultDate}
              defaultTime={activePlanner.defaultTime}
              onCancel={() => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                ) closePlanner();
              }}
              onGatheringChanged={(gathering) => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                  && gathering.familyId === activePlanner.familyId
                ) {
                  confirmedPlannerKeysRef.current.add(activePlanner.idempotencyKey);
                  if (manualPlannerRetryRef.current?.idempotencyKey === activePlanner.idempotencyKey) {
                    manualPlannerRetryRef.current = null;
                  }
                  if (activePlanner.source === 'manual' && activePlanner.currentUserId) {
                    clearManualGatheringRetryState(activePlanner.currentUserId, activePlanner.familyId);
                  }
                  upsertGathering(gathering);
                }
              }}
              onViewCalendar={() => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                ) closePlanner();
              }}
              onStageChange={(stage) => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                ) setPlannerStage(stage);
              }}
              onBusyChange={(busy) => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                ) setPlannerBusy(busy);
              }}
              onCreateOutcomeUncertainChange={(uncertain) => {
                if (
                  mountedRef.current
                  && activeFamilyIdRef.current === activePlanner.familyId
                  && plannerRequestVersionRef.current === activePlanner.requestVersion
                ) {
                  if (activePlanner.source === 'manual') {
                    manualPlannerRetryRef.current = uncertain ? {
                      familyId: activePlanner.familyId,
                      currentUserId: activePlanner.currentUserId,
                      idempotencyKey: activePlanner.idempotencyKey,
                      uncertainCreateOutcome: true,
                    } : null;
                    if (activePlanner.currentUserId) {
                      if (uncertain) {
                        writeManualGatheringRetryState(
                          activePlanner.currentUserId,
                          activePlanner.familyId,
                          activePlanner.idempotencyKey,
                        );
                      } else {
                        clearManualGatheringRetryState(activePlanner.currentUserId, activePlanner.familyId);
                      }
                    }
                  }
                  setActivePlanner(current => (
                    current?.requestVersion === activePlanner.requestVersion
                      ? { ...current, uncertainCreateOutcome: uncertain }
                      : current
                  ));
                }
              }}
              onDiscardUncertainRetry={activePlanner.source === 'manual' ? discardUncertainManualRetry : undefined}
              />
            </div>
          </ModalShell>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {inviteTarget && inviteTarget.familyId === familyId ? (
          <ModalShell title={inviteStage === 'choose' ? `Invite to ${inviteTarget.title}` : inviteStage === 'review' ? 'Review link preparation' : 'Invitation links'} onClose={closeInviteModal} closeDisabled={inviteBusy} scrollRoot={modalScrollRootRef}>
            {inviteStage === 'choose' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mobile-sheet-scroll-region space-y-4 overflow-y-auto p-4 sm:p-6">
                  <p className="text-sm text-ink/70">Select people who should receive a new private RSVP link.</p>
                  <MemberPicker members={members} selected={inviteMemberIds} onToggle={id => setInviteMemberIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])} />
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">Family members who use AILAH will also receive an in-app RSVP notification.</div>
                </div>
                <footer className="mobile-sheet-footer mt-auto flex shrink-0 justify-end gap-3 border-t border-sepia bg-sand px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
                  <button type="button" onClick={closeInviteModal} className="min-h-11 px-4 text-sm font-semibold">Cancel</button>
                  <button type="button" disabled={inviteMemberIds.length === 0} onClick={() => setInviteStage('review')} className="min-h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">Review</button>
                </footer>
              </div>
            ) : inviteStage === 'review' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mobile-sheet-scroll-region space-y-4 overflow-y-auto p-4 sm:p-6">
                  <div className="rounded-2xl border border-sepia p-4 sm:p-5">
                    <h4 className="font-serif text-lg font-bold">{inviteTarget.title}</h4>
                    <p className="mt-3 flex items-center gap-2 text-sm"><Users size={14} className="text-gold" /> Prepare {inviteMemberIds.length} private RSVP link{inviteMemberIds.length === 1 ? '' : 's'}</p>
                    <p className="mt-2 flex items-center gap-2 text-sm"><Send size={14} className="text-gold" /> Copyable RSVP links will be created for the selected family members</p>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">You can copy each link after confirming. App users will see the RSVP invitation inside AILAH.</div>
                  {inviteError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{inviteError}</p> : null}
                </div>
                <footer className="mobile-sheet-footer mt-auto flex shrink-0 justify-end gap-3 border-t border-sepia bg-sand px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
                  <button type="button" disabled={inviteBusy} onClick={() => setInviteStage('choose')} className="min-h-11 px-4 text-sm font-semibold">Back</button>
                  <button type="button" disabled={inviteBusy} onClick={() => void prepareExistingInvitations()} className="flex min-h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{inviteBusy ? <LoaderCircle className="animate-spin" size={13} /> : <Link2 size={13} />} Confirm & prepare</button>
                </footer>
              </div>
            ) : invitePrepared ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mobile-sheet-scroll-region overflow-y-auto p-4 sm:p-6"><PreparedLinks invitations={invitePrepared.invitations} deliveryNotice={invitePrepared.deliveryNotice} /></div>
                <footer className="mobile-sheet-footer mt-auto flex shrink-0 justify-end border-t border-sepia bg-sand px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4"><button type="button" onClick={closeInviteModal} className="min-h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white">Done</button></footer>
              </div>
            ) : null}
          </ModalShell>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
