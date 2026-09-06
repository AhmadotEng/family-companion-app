/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
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

function FullPageStatus({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-sand flex items-center justify-center p-6">
      <div className="bg-white border border-sepia rounded-[2rem] px-10 py-9 text-center shadow-xl">
        <LoaderCircle className="animate-spin text-gold mx-auto" size={30} />
        <p className="font-serif italic text-lg mt-4">{message}</p>
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
          setContextError(caught instanceof ApiError ? caught.message : 'Unable to reach the Family Companion server.');
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
      setContextLoading(false);
      setContextError('');
      setActiveTab('home');
    }
  };

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

  const currentFamilyId = familyContext?.family.id || activeFamilyId || '';
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
              `Create a reconnection plan using the sample activity "${activity.title}" in ${activity.emirate}. Ask me who should join, the date, budget, and accessibility needs before proposing it.`,
            )}
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
      case 'archive':
        return (
          <MemoriesRewards
            familyId={currentFamilyId}
            familyRole={familyContext?.family.role}
            currentUserId={session?.user.id}
            members={members}
            refreshVersion={archiveRefreshVersion}
          />
        );
      case 'more':
        return session ? <More user={session.user} /> : null;
      default:
        return null;
    }
  }, [activeTab, archiveRefreshVersion, assistantPreset, calendarFocusTarget, calendarRefreshVersion, clearGatheringPlanPrefill, currentFamilyId, currentMemberId, familyContext?.family.name, familyContext?.family.role, gatheringPlanPrefill, handleAgentActionCompleted, homeGatherings, members, navigateToAgentActionResult, openGatheringDraftFromPlan, refreshContext, session]);

  if (booting) return <FullPageStatus message="Opening your private family space…" />;
  if (!session) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  if (!activeFamilyId) {
    return (
      <main className="min-h-screen bg-sand flex items-center justify-center p-6">
        <section className="max-w-md bg-white border border-sepia rounded-[2rem] p-8 text-center shadow-xl">
          <ShieldAlert className="text-gold mx-auto" size={32} />
          <h1 className="font-serif italic text-2xl mt-4">No family space assigned</h1>
          <p className="text-sm text-ink/60 mt-3">This account is valid, but it is not linked to a family yet. Ask a family administrator to add it.</p>
          <button onClick={handleLogout} className="mt-6 text-[10px] uppercase tracking-widest font-bold text-gold hover:text-ink">Sign out</button>
        </section>
      </main>
    );
  }

  if (contextLoading && !familyContext) return <FullPageStatus message="Loading the family map…" />;

  if (contextError && !familyContext) {
    return (
      <main className="min-h-screen bg-sand flex items-center justify-center p-6">
        <section className="max-w-md bg-white border border-sepia rounded-[2rem] p-8 text-center shadow-xl">
          <ShieldAlert className="text-red-500 mx-auto" size={32} />
          <h1 className="font-serif italic text-2xl mt-4">Family data could not load</h1>
          <p role="alert" className="text-sm text-ink/60 mt-3">{contextError}</p>
          <div className="flex justify-center gap-4 mt-6">
            <button onClick={refreshContext} className="bg-ink text-white px-5 py-2.5 rounded-xl text-[10px] uppercase tracking-widest font-bold flex items-center gap-2"><RefreshCw size={14} /> Retry</button>
            <button onClick={handleLogout} className="border border-sepia px-5 py-2.5 rounded-xl text-[10px] uppercase tracking-widest font-bold">Sign out</button>
          </div>
        </section>
      </main>
    );
  }

  const titles: Record<string, string> = {
    home: 'Family Dashboard',
    assistant: 'AI Family Companion',
    activities: 'Family Activities',
    tree: 'Digital Family Tree',
    calendar: 'Family Calendar',
    archive: 'Memories & Rewards',
    more: 'Settings & Profile'
  };

  return (
    <div className="relative">
      <Layout activeTab={activeTab} setActiveTab={setActiveTab} title={titles[activeTab]}>
        {contextError && (
          <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-4">
            <span>{contextError}</span>
            <button onClick={refreshContext} className="font-bold uppercase tracking-wider">Retry</button>
          </div>
        )}
        <div key={`assistant-${currentFamilyId}`} hidden={activeTab !== 'assistant'}>
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
        {activeTab !== 'assistant' ? <div key={`screen-${activeTab}`}>{content}</div> : null}
      </Layout>
      <button
        type="button"
        onClick={handleLogout}
        className="fixed right-5 top-6 z-30 flex items-center gap-2 rounded-full border border-sepia bg-white/95 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-ink/60 shadow-sm hover:border-gold hover:text-ink"
        aria-label={`Sign out ${session.user.displayName}`}
        title={`Signed in as ${session.user.email}`}
      >
        <LogOut size={13} /> <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}

export default function App() {
  const invitationToken = invitationTokenFromPath(window.location.pathname);
  if (isInvitationPath(window.location.pathname)) return <PublicInvitationScreen token={invitationToken ?? ''} />;
  return <AuthenticatedApp />;
}
