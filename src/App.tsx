/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Layout } from './components/Layout';
import { Home } from './screens/Home';
import {
  Assistant,
  clearStoredAgentSessions,
  type AgentResultNavigationTarget,
} from './screens/Assistant';
import { Activities } from './screens/Activities';
import { FamilyTree } from './screens/FamilyTree';
import { Calendar, type CalendarFocusTarget } from './screens/Calendar';
import { MemoriesRewards } from './screens/MemoriesRewards';
import { memoriesRewardsApi } from './api/memoriesRewards';
import { More } from './screens/More';
import { PublicInvitationScreen } from './screens/PublicInvitation';
import { AuthScreen } from './auth/AuthScreen';
import { ApiError, authApi, familyApi } from './api/client';
import { engagementApi } from './api/engagement';
import type { GatheringPlanPrefill } from './api/reconnectionPlans';
import { adaptFamilyContext } from './api/familyAdapter';
import type { PersistentGathering } from './engagementTypes';
import { formatDubaiDateKey } from './lib/gatheringDate';
import { invitationTokenFromPath, isInvitationPath } from './lib/invitationRoute';
import { getAgentResultDestination } from './lib/agentPresentation';
import { clearAllManualGatheringRetryStates } from './lib/manualGatheringRetry';
import type { AgentActionCompletion } from './screens/Assistant';
import { AuthSession, FamilyContext, FamilyMember, Gathering } from './types';
import { useLanguage } from './i18n';

function FullPageStatus({ message }: { message: string }) {
  return (
    <main className="standalone-page min-h-[100dvh] bg-sand flex items-center justify-center p-6">
      <div className="w-full min-w-0 max-w-md rounded-3xl border border-sepia bg-white px-5 py-7 text-center shadow-xl sm:rounded-[2rem] sm:px-10 sm:py-9">
        <LoaderCircle className="animate-spin text-gold mx-auto" size={30} />
        <p className="font-serif text-lg mt-4">{message}</p>
      </div>
    </main>
  );
}

function toHomeGathering(gathering: PersistentGathering): Gathering {
  const responseLabels: Gathering['rsvpStatus'] = {};
  gathering.invitations.forEach(invitation => {
    responseLabels[invitation.memberId] = {
      pending: 'Pending',
      going: 'Going',
      maybe: 'Maybe',
      declined: 'Not Going',
    }[invitation.status] as Gathering['rsvpStatus'][string];
  });
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(gathering.startAt));
  return {
    id: gathering.id,
    title: gathering.title,
    purpose: gathering.purpose,
    date: formatDubaiDateKey(gathering.startAt),
    time,
    location: gathering.locationName,
    invitedMembers: gathering.invitations.map(invitation => invitation.memberId),
    rsvpStatus: responseLabels,
    notes: gathering.notes,
    createdBy: gathering.createdByUserId,
    type: gathering.type,
  };
}

function AuthenticatedApp() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('home');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [familyContext, setFamilyContext] = useState<FamilyContext | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [persistentGatherings, setPersistentGatherings] = useState<PersistentGathering[]>([]);
  const [assistantPreset, setAssistantPreset] = useState('');
  const [gatheringPlanPrefill, setGatheringPlanPrefill] = useState<GatheringPlanPrefill | null>(null);
  const [calendarRefreshVersion, setCalendarRefreshVersion] = useState(0);
  const [calendarFocusTarget, setCalendarFocusTarget] = useState<CalendarFocusTarget | null>(null);
  const [archiveRefreshVersion, setArchiveRefreshVersion] = useState(0);
  const [rewardPoints, setRewardPoints] = useState<number | null>(null);
  const [archiveViewVersion, setArchiveViewVersion] = useState(0);
  const [assistantReturnTab, setAssistantReturnTab] = useState('home');
  const [heritageLocationSettingsRequested, setHeritageLocationSettingsRequested] = useState(false);
  const [booting, setBooting] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const mountedRef = useRef(false);
  const contextEpochRef = useRef(0);
  const activeFamilyIdRef = useRef<string | null>(activeFamilyId);
  const activeUserIdRef = useRef<string | null>(session?.user.id ?? null);
  const familyLoadRequestVersionRef = useRef(0);
  const gatheringRefreshRequestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      contextEpochRef.current += 1;
      familyLoadRequestVersionRef.current += 1;
      gatheringRefreshRequestVersionRef.current += 1;
    };
  }, []);

  const isCurrentAppContext = useCallback((
    expectedEpoch: number,
    expectedFamilyId: string,
    expectedUserId: string,
  ) => mountedRef.current
    && contextEpochRef.current === expectedEpoch
    && activeFamilyIdRef.current === expectedFamilyId
    && activeUserIdRef.current === expectedUserId, []);

  const loadFamily = useCallback(async (familyId: string) => {
    const expectedEpoch = contextEpochRef.current;
    const expectedUserId = activeUserIdRef.current;
    if (!expectedUserId || activeFamilyIdRef.current !== familyId) return;
    const requestVersion = ++familyLoadRequestVersionRef.current;
    const gatheringRequestVersion = ++gatheringRefreshRequestVersionRef.current;
    const isCurrentRequest = () => isCurrentAppContext(expectedEpoch, familyId, expectedUserId)
      && familyLoadRequestVersionRef.current === requestVersion;
    setContextLoading(true);
    setContextError('');
    try {
      const [contextResult, gatheringResult] = await Promise.allSettled([
        familyApi.getContext(familyId),
        engagementApi.listGatherings(familyId),
      ]);
      if (contextResult.status === 'rejected') throw contextResult.reason;
      if (!isCurrentRequest()) return;
      const context = contextResult.value;
      setFamilyContext(context);
      setMembers(adaptFamilyContext(context));
      if (gatheringRefreshRequestVersionRef.current !== gatheringRequestVersion) return;
      if (gatheringResult.status === 'fulfilled') {
        setPersistentGatherings(gatheringResult.value.gatherings);
      } else {
        setPersistentGatherings([]);
        setContextError(
          gatheringResult.reason instanceof ApiError
            ? `Family loaded, but gatherings could not load: ${gatheringResult.reason.message}`
            : 'Family loaded, but gatherings could not load.',
        );
      }
    } catch (caught) {
      if (!isCurrentRequest()) return;
      setFamilyContext(null);
      setMembers([]);
      setPersistentGatherings([]);
      setContextError(caught instanceof ApiError ? caught.message : 'Unable to load this family space.');
    } finally {
      if (isCurrentRequest()) setContextLoading(false);
    }
  }, [isCurrentAppContext]);

  const acceptSession = useCallback(async (nextSession: AuthSession) => {
    const expectedEpoch = ++contextEpochRef.current;
    familyLoadRequestVersionRef.current += 1;
    gatheringRefreshRequestVersionRef.current += 1;
    const familyId = nextSession.activeFamilyId || nextSession.families[0]?.id || null;
    activeUserIdRef.current = nextSession.user.id;
    activeFamilyIdRef.current = familyId;
    setSession(nextSession);
    setCalendarFocusTarget(null);
    setActiveFamilyId(familyId);
    setFamilyContext(null);
    setMembers([]);
    setPersistentGatherings([]);
    setContextError('');
    if (familyId) await loadFamily(familyId);
    else setContextLoading(false);
    return expectedEpoch;
  }, [loadFamily]);

  useEffect(() => {
    let current = true;
    authApi.me()
      .then(async nextSession => {
        if (!current) return;
        await acceptSession(nextSession);
      })
      .catch(caught => {
        if (!current) return;
        if (!(caught instanceof ApiError) || caught.status !== 401) {
          setContextError(caught instanceof ApiError ? caught.message : 'Unable to reach the AILAH server.');
        }
      })
      .finally(() => {
        if (current) setBooting(false);
      });
    return () => {
      current = false;
    };
  }, [acceptSession]);

  const refreshContext = useCallback(async () => {
    if (activeFamilyId) await loadFamily(activeFamilyId);
  }, [activeFamilyId, loadFamily]);

  const handleAgentActionCompleted = useCallback(async ({ resources }: AgentActionCompletion) => {
    const expectedFamilyId = activeFamilyIdRef.current;
    const expectedUserId = activeUserIdRef.current;
    const expectedEpoch = contextEpochRef.current;
    if (!expectedFamilyId || !expectedUserId) return;
    const isCurrentRequest = () => isCurrentAppContext(expectedEpoch, expectedFamilyId, expectedUserId);

    if (resources.includes('family')) {
      await loadFamily(expectedFamilyId);
      if (!isCurrentRequest()) return;
    } else if (resources.includes('gatherings')) {
      const requestVersion = ++gatheringRefreshRequestVersionRef.current;
      try {
        const result = await engagementApi.listGatherings(expectedFamilyId);
        if (!isCurrentRequest() || gatheringRefreshRequestVersionRef.current !== requestVersion) return;
        setPersistentGatherings(result.gatherings);
      } catch (caught) {
        if (!isCurrentRequest() || gatheringRefreshRequestVersionRef.current !== requestVersion) return;
        setContextError(caught instanceof ApiError
          ? `The action completed, but gatherings could not refresh: ${caught.message}`
          : 'The action completed, but gatherings could not refresh.');
      }
    }

    if (!isCurrentRequest()) return;
    if (resources.includes('gatherings')) {
      setCalendarRefreshVersion((current) => current + 1);
    }
    if (resources.includes('memories') || resources.includes('rewards')) {
      setArchiveRefreshVersion((current) => current + 1);
    }
  }, [isCurrentAppContext, loadFamily]);

  const navigateToAgentActionResult = useCallback((
    actionType: string,
    target?: AgentResultNavigationTarget,
  ) => {
    const destination = getAgentResultDestination(actionType);
    if (destination === 'calendar' && activeFamilyId && target?.startAt) {
      setCalendarFocusTarget({
        familyId: activeFamilyId,
        ...(target.gatheringId ? { gatheringId: target.gatheringId } : {}),
        startAt: target.startAt,
      });
    }
    if (destination) setActiveTab(destination);
  }, [activeFamilyId]);

  const handleAuthenticated = async (nextSession: AuthSession) => {
    setBooting(true);
    let expectedEpoch = contextEpochRef.current;
    try {
      expectedEpoch = await acceptSession(nextSession);
    } finally {
      if (mountedRef.current && contextEpochRef.current === expectedEpoch) setBooting(false);
    }
  };

  const handleLogout = async () => {
    contextEpochRef.current += 1;
    familyLoadRequestVersionRef.current += 1;
    gatheringRefreshRequestVersionRef.current += 1;
    activeUserIdRef.current = null;
    activeFamilyIdRef.current = null;
    clearAllManualGatheringRetryStates();
    try {
      await authApi.logout();
    } finally {
      clearStoredAgentSessions();
      setSession(null);
      setActiveFamilyId(null);
      setFamilyContext(null);
      setMembers([]);
      setPersistentGatherings([]);
      setGatheringPlanPrefill(null);
      setCalendarFocusTarget(null);
      setHeritageLocationSettingsRequested(false);
      setContextLoading(false);
      setContextError('');
      setActiveTab('home');
    }
  };

  const openMemories = useCallback(() => {
    setArchiveViewVersion(version => version + 1);
    setActiveTab('archive');
  }, []);
  void openMemories;

  const navigateToAssistant = (presetText: string) => {
    setAssistantPreset(presetText);
    setActiveTab('assistant');
  };

  const openGatheringDraftFromPlan = useCallback((prefill: GatheringPlanPrefill) => {
    setCalendarFocusTarget(null);
    setGatheringPlanPrefill(prefill);
    setActiveTab('calendar');
  }, []);

  const clearGatheringPlanPrefill = useCallback(() => setGatheringPlanPrefill(null), []);

  const openHeritageLocationSettings = useCallback(() => {
    setHeritageLocationSettingsRequested(true);
    setActiveTab('tree');
  }, []);

  const clearHeritageLocationSettingsRequest = useCallback(() => {
    setHeritageLocationSettingsRequested(false);
  }, []);

  const currentFamilyId = familyContext?.family.id || activeFamilyId || '';

  useEffect(() => {
    if (!currentFamilyId) {
      setRewardPoints(null);
      return;
    }
    let current = true;
    memoriesRewardsApi.getRewards(currentFamilyId)
      .then(summary => {
        if (current) setRewardPoints(summary.balance);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [currentFamilyId, archiveRefreshVersion]);

  const openRewards = useCallback(() => {
    setArchiveViewVersion(version => version + 1);
    setActiveTab('rewards');
  }, []);

  const toggleAssistant = useCallback(() => {
    setActiveTab(current => {
      if (current === 'assistant') return assistantReturnTab;
      setAssistantReturnTab(current);
      return 'assistant';
    });
  }, [assistantReturnTab]);
  const currentMemberId = familyContext?.currentUser.linkedMemberId;
  const homeGatherings = useMemo(() => persistentGatherings.map(toHomeGathering), [persistentGatherings]);

  const content = useMemo(() => {
    switch (activeTab) {
      case 'home':
        return (
          <Home
            members={members}
            gatherings={homeGatherings}
            setActiveTab={setActiveTab}
            navigateToAssistant={navigateToAssistant}
          />
        );
      case 'assistant':
        return null;
      case 'activities':
        return (
          <Activities
            members={members}
            onPlanActivity={activity => navigateToAssistant(
              `Help me plan “${activity.title}” at ${activity.location} in ${activity.emirate}. Ask who should join and what date works.`,
            )}
            onPlanManually={activity => openGatheringDraftFromPlan({
              sourcePlanId: `activity-${activity.id}`,
              sourcePlanTitle: activity.title,
              title: activity.title,
              purpose: `Family time at ${activity.location}`,
              type: activity.category,
              locationName: `${activity.location}, ${activity.emirate}`,
              notes: `${activity.description}\nSuggested duration: ${activity.estimatedDuration}.`,
              memberIds: [],
            })}
          />
        );
      case 'tree':
        return (
          <FamilyTree
            familyId={currentFamilyId}
            familyName={familyContext?.family.name || 'Family'}
            members={members}
            currentUserMemberId={currentMemberId}
            familyRole={familyContext?.family.role}
            onRefresh={refreshContext}
            openLocationSettingsRequest={heritageLocationSettingsRequested}
            onLocationSettingsRequestHandled={clearHeritageLocationSettingsRequest}
          />
        );
      case 'calendar':
        return (
          <Calendar
            familyId={currentFamilyId}
            members={members}
            familyRole={familyContext?.family.role}
            currentUserId={session?.user.id}
            planPrefill={gatheringPlanPrefill}
            onPlanPrefillConsumed={clearGatheringPlanPrefill}
            onGatheringsChanged={setPersistentGatherings}
            refreshVersion={calendarRefreshVersion}
            focusTarget={calendarFocusTarget}
          />
        );
      case 'rewards':
        return (
          <MemoriesRewards
            familyId={currentFamilyId}
            familyRole={familyContext?.family.role}
            currentUserId={session?.user.id}
            members={members}
            refreshVersion={archiveRefreshVersion}
            requestedView="rewards"
            viewRequestVersion={archiveViewVersion}
          />
        );
      case 'archive':
        return (
          <MemoriesRewards
            familyId={currentFamilyId}
            familyRole={familyContext?.family.role}
            currentUserId={session?.user.id}
            members={members}
            refreshVersion={archiveRefreshVersion}
            requestedView="memories"
            viewRequestVersion={archiveViewVersion}
          />
        );
      case 'more':
        return session ? <More user={session.user} /> : null;
      default:
        return null;
    }
  }, [activeTab, archiveRefreshVersion, assistantPreset, calendarFocusTarget, calendarRefreshVersion, clearGatheringPlanPrefill, clearHeritageLocationSettingsRequest, currentFamilyId, currentMemberId, familyContext?.family.name, familyContext?.family.role, gatheringPlanPrefill, handleAgentActionCompleted, heritageLocationSettingsRequested, homeGatherings, members, navigateToAgentActionResult, openGatheringDraftFromPlan, refreshContext, session]);

  if (booting) return <FullPageStatus message="Opening your private family space…" />;
  if (!session) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  if (!activeFamilyId) {
    return (
      <main className="standalone-page min-h-[100dvh] bg-sand flex items-center justify-center p-6">
        <section className="w-full min-w-0 max-w-md rounded-3xl border border-sepia bg-white p-5 text-center shadow-xl sm:rounded-[2rem] sm:p-8">
          <ShieldAlert className="text-gold mx-auto" size={32} />
          <h1 className="font-serif text-2xl mt-4">No family space assigned</h1>
          <p className="text-sm text-ink/60 mt-3">This account is valid, but it is not linked to a family yet. Ask a family administrator to add it.</p>
          <button onClick={handleLogout} className="mt-6 min-h-11 rounded-xl px-4 text-sm font-semibold text-gold-ink hover:bg-sand hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Sign out</button>
        </section>
      </main>
    );
  }

  if (contextLoading && !familyContext) return <FullPageStatus message="Loading the family map…" />;

  if (contextError && !familyContext) {
    return (
      <main className="standalone-page min-h-[100dvh] bg-sand flex items-center justify-center p-6">
        <section className="w-full min-w-0 max-w-md rounded-3xl border border-sepia bg-white p-5 text-center shadow-xl sm:rounded-[2rem] sm:p-8">
          <ShieldAlert className="text-red-500 mx-auto" size={32} />
          <h1 className="font-serif text-2xl mt-4">Family data could not load</h1>
          <p role="alert" className="mt-3 break-words text-sm text-ink/60">{contextError}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 sm:gap-4">
            <button onClick={refreshContext} className="flex min-h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-white"><RefreshCw size={14} /> Retry</button>
            <button onClick={handleLogout} className="min-h-11 rounded-xl border border-sepia px-5 text-sm font-semibold">Sign out</button>
          </div>
        </section>
      </main>
    );
  }

  const titles: Record<string, string> = {
    home: 'Home',
    assistant: 'SILAH',
    activities: 'Activities',
    tree: 'Family',
    calendar: 'Gatherings',
    archive: 'Memories',
    rewards: 'Rewards',
    more: 'Profile and account'
  };

  return (
    <div className="relative">
      <Layout
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        title={t(titles[activeTab])}
        onSignOut={handleLogout}
        onOpenLocationSettings={openHeritageLocationSettings}
        accountName={session.user.displayName}
        rewardPoints={rewardPoints ?? undefined}
        onOpenRewards={openRewards}
        onToggleAssistant={toggleAssistant}
      >
        {contextError && (
          <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-4">
            <span>{contextError}</span>
            <button onClick={refreshContext} className="min-h-11 rounded-lg px-3 font-bold">Retry</button>
          </div>
        )}
        <div
          key={`assistant-${currentFamilyId}`}
          hidden={activeTab !== 'assistant'}
          className={activeTab === 'assistant' ? 'flex min-h-0 flex-1 flex-col' : undefined}
        >
          <Assistant
            presetInput={assistantPreset}
            clearPreset={() => setAssistantPreset('')}
            familyId={currentFamilyId}
            members={members}
            familyRole={familyContext?.family.role}
            isActive={activeTab === 'assistant'}
            onActionCompleted={handleAgentActionCompleted}
            onNavigateToActionResult={navigateToAgentActionResult}
            onUseReconnectionPlan={openGatheringDraftFromPlan}
          />
        </div>
        {activeTab !== 'assistant' ? (
          <div key={`screen-${activeTab}`} className={activeTab === 'tree' ? 'flex min-h-0 flex-1 flex-col md:block' : undefined}>
            {content}
          </div>
        ) : null}
      </Layout>
    </div>
  );
}

export default function App() {
  const invitationToken = invitationTokenFromPath(window.location.pathname);
  if (isInvitationPath(window.location.pathname)) return <PublicInvitationScreen token={invitationToken ?? ''} />;
  return <AuthenticatedApp />;
}
