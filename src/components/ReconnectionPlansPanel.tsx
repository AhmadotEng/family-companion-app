import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { ReconnectionPlan } from '../engagementTypes';
import {
  type GatheringPlanPrefill,
  reconnectionPlanToGatheringPrefill,
  reconnectionPlansApi,
  type ReconnectionPlanUpdateStatus,
} from '../api/reconnectionPlans';
import { ApiError } from '../api/client';
import type { FamilyMember } from '../types';
import { cn } from '../lib/utils';

interface ReconnectionPlansPanelProps {
  familyId: string;
  members: FamilyMember[];
  refreshVersion?: number;
  onUsePlan: (prefill: GatheringPlanPrefill) => void;
}

const statusLabel: Record<ReconnectionPlan['status'], string> = {
  active: 'Ready to review',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  completed: 'Completed',
};

function requestErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
}

export function ReconnectionPlansPanel({
  familyId,
  members,
  refreshVersion = 0,
  onUsePlan,
}: ReconnectionPlansPanelProps) {
  const [plans, setPlans] = useState<ReconnectionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [updatingPlanId, setUpdatingPlanId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const activeFamilyIdRef = useRef(familyId);
  const mountedRef = useRef(false);
  const loadRequestVersionRef = useRef(0);
  const statusRequestVersionRef = useRef(0);
  activeFamilyIdRef.current = familyId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestVersionRef.current += 1;
      statusRequestVersionRef.current += 1;
    };
  }, []);

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const loadPlans = useCallback(async () => {
    const requestedFamilyId = familyId;
    const requestVersion = ++loadRequestVersionRef.current;
    if (!familyId) {
      setPlans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const result = await reconnectionPlansApi.list(requestedFamilyId);
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      setPlans(result.plans);
    } catch (caught) {
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      setPlans([]);
      setLoadError(requestErrorMessage(caught, 'Stored reconnection plans could not be loaded.'));
      setExpanded(true);
    } finally {
      if (
        mountedRef.current
        && activeFamilyIdRef.current === requestedFamilyId
        && loadRequestVersionRef.current === requestVersion
      ) setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    loadRequestVersionRef.current += 1;
    statusRequestVersionRef.current += 1;
    setPlans([]);
    setLoading(Boolean(familyId));
    setLoadError('');
    setActionError('');
    setUpdatingPlanId('');
    setExpanded(false);
    setShowAll(false);
  }, [familyId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans, refreshVersion]);

  const updateStatus = async (planId: string, status: ReconnectionPlanUpdateStatus) => {
    const requestedFamilyId = familyId;
    const requestVersion = ++statusRequestVersionRef.current;
    setUpdatingPlanId(planId);
    setActionError('');
    try {
      const result = await reconnectionPlansApi.updateStatus(planId, status);
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || statusRequestVersionRef.current !== requestVersion
      ) return;
      setPlans((current) => current.map((plan) => (
        plan.id === result.id ? { ...plan, status: result.status, updatedAt: new Date().toISOString() } : plan
      )));
    } catch (caught) {
      if (
        !mountedRef.current
        || activeFamilyIdRef.current !== requestedFamilyId
        || statusRequestVersionRef.current !== requestVersion
      ) return;
      setActionError(requestErrorMessage(caught, 'The plan status could not be changed.'));
    } finally {
      if (
        mountedRef.current
        && activeFamilyIdRef.current === requestedFamilyId
        && statusRequestVersionRef.current === requestVersion
      ) setUpdatingPlanId('');
    }
  };

  const visiblePlans = showAll ? plans : plans.slice(0, 1);
  const summaryStatus = loading
    ? 'Loading…'
    : loadError
      ? 'Unavailable'
      : `${plans.length} stored`;

  return (
    <section
      className="shrink-0 overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm"
      aria-labelledby="stored-plans-title"
      data-reconnection-plans={expanded ? 'expanded' : 'collapsed'}
    >
      <header className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-sand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
          aria-expanded={expanded}
          aria-controls="stored-reconnection-plan-content"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
            <Sparkles size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span id="stored-plans-title" className="block truncate text-xs font-bold text-ink">Stored reconnection plans</span>
            <span className="block text-[11px] text-ink/50">{summaryStatus}</span>
          </span>
          <ChevronDown size={17} className={cn('shrink-0 text-ink/45 transition-transform', expanded && 'rotate-180')} />
        </button>
        {expanded ? (
          <button
            type="button"
            onClick={() => void loadPlans()}
            disabled={loading}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink/45 hover:bg-sand/50 hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:opacity-40"
            aria-label="Refresh stored reconnection plans"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        ) : null}
      </header>

      {expanded ? (
        <div id="stored-reconnection-plan-content" className="max-h-[40dvh] overflow-y-auto overscroll-contain border-t border-sepia/70 px-3 pb-3 pt-2 sm:max-h-none sm:overflow-visible">
          <p className="mb-3 text-[11px] leading-relaxed text-ink/55">
            Confirmed AI-assisted suggestions remain drafts until you create a gathering. Status changes require the plan creator or a family administrator.
          </p>
          {loading ? (
            <div className="flex min-h-11 items-center gap-2 text-xs text-ink/45"><LoaderCircle className="animate-spin text-gold" size={14} /> Loading stored plans…</div>
          ) : loadError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => void loadPlans()} className="min-h-11 px-2 font-bold">Retry</button>
            </div>
          ) : plans.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sepia p-3 text-xs text-ink/45">
              No stored plans yet. Ask the agent for a reconnection plan, then review and confirm its proposal.
            </p>
          ) : (
            <div>
              <div className={cn('space-y-3', showAll && 'max-h-72 overflow-y-auto overscroll-contain pr-1 custom-scrollbar')}>
                {visiblePlans.map((plan) => {
                  const knownNames = plan.suggestedMemberIds
                    .map((id) => memberNames.get(id))
                    .filter((name): name is string => Boolean(name));
                  const unavailableCount = plan.suggestedMemberIds.length - knownNames.length;
                  const busy = updatingPlanId === plan.id;
                  return (
                    <article key={plan.id} className="rounded-2xl border border-sepia/70 bg-sand/20 p-3 sm:p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-serif text-base font-bold italic text-ink">{plan.title}</h3>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink/55">{plan.rationale}</p>
                        </div>
                        <span className={cn(
                          'rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide',
                          plan.status === 'active' && 'bg-blue-100 text-blue-800',
                          plan.status === 'accepted' && 'bg-emerald-100 text-emerald-800',
                          plan.status === 'dismissed' && 'bg-gray-100 text-gray-600',
                          plan.status === 'completed' && 'bg-gold/15 text-gold-ink',
                        )}>{statusLabel[plan.status]}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink/50">
                        <span className="flex items-center gap-1.5"><Users size={12} className="text-gold" /> {knownNames.join(', ') || 'No visible member names'}{unavailableCount ? ` + ${unavailableCount} unavailable` : ''}</span>
                        <span>{plan.suggestedGathering.durationMinutes} min · {plan.suggestedGathering.format.replaceAll('_', ' ')}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {plan.status !== 'completed' && plan.status !== 'dismissed' ? (
                          <button
                            type="button"
                            onClick={() => onUsePlan(reconnectionPlanToGatheringPrefill(plan))}
                            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-ink px-3 text-[11px] font-bold tracking-wide text-white hover:bg-gold-ink"
                          >
                            <CalendarPlus size={13} /> Open editable draft
                          </button>
                        ) : null}
                        {plan.status === 'active' || plan.status === 'dismissed' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPlanId)}
                            onClick={() => void updateStatus(plan.id, 'accepted')}
                            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-sepia px-3 text-[11px] font-bold tracking-wide hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40"
                          >
                            {busy ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />}
                            {plan.status === 'dismissed' ? 'Restore' : 'Accept'}
                          </button>
                        ) : null}
                        {plan.status === 'active' || plan.status === 'accepted' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPlanId)}
                            onClick={() => void updateStatus(plan.id, 'dismissed')}
                            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-sepia px-3 text-[11px] font-bold tracking-wide text-ink/55 hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                          >
                            {busy ? <LoaderCircle className="animate-spin" size={13} /> : <X size={13} />} Dismiss
                          </button>
                        ) : null}
                        {plan.status === 'accepted' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPlanId)}
                            onClick={() => void updateStatus(plan.id, 'completed')}
                            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-sepia px-3 text-[11px] font-bold tracking-wide text-ink/55 hover:border-gold-ink hover:text-gold-ink disabled:opacity-40"
                          >
                            {busy ? <LoaderCircle className="animate-spin" size={13} /> : <CheckCheck size={13} />} Mark completed
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {plans.length > 1 ? (
                <button type="button" onClick={() => setShowAll((current) => !current)} className="mt-2 min-h-11 text-[11px] font-bold tracking-wide text-gold-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">
                  {showAll ? 'Show latest plan only' : `Show ${plans.length - 1} more plan${plans.length - 1 === 1 ? '' : 's'}`}
                </button>
              ) : null}
            </div>
          )}
          {actionError ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{actionError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
