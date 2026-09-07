import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { ApiError, apiRequest } from '../api/client';
import { ReconnectionPlansPanel } from '../components/ReconnectionPlansPanel';
import { PreparedInvitationLinks } from '../components/PreparedInvitationLinks';
import {
  GatheringPlanner,
  type GatheringPlannerPrefill,
  type GatheringPlannerStage,
  type GatheringPlannerSubmissionResult,
} from '../components/GatheringPlanner';
import type { GatheringPlanPrefill } from '../api/reconnectionPlans';
import type { PersistentGathering } from '../engagementTypes';
import {
  agentWelcomeText,
  agentDataDisclosureText,
  buildDestructiveAgentConfirmation,
  canRoleConfirmAgentAction,
  formatAgentDetail,
  getAgentActionResources,
  getAgentConfirmButtonLabel,
  getAgentQuickPrompts,
  getAgentResultDestinationLabel,
  getAgentRoleNotice,
  humanizeAgentLabel,
  invitationLinksUnavailableMessage,
  isDestructiveAgentAction,
  isKnownAgentActionType,
  type AgentActionType,
  type AgentResource,
} from '../lib/agentPresentation';
import {
  extractEphemeralInvitationLinks,
  type EphemeralInvitationLinks,
} from '../lib/agentInvitationLinks';
import { formatDubaiDateKey, formatDubaiDateTime } from '../lib/gatheringDate';
import { GATHERING_TYPES } from '../lib/gatheringPlanner';
import { useModalFocusTrap } from '../lib/modalFocus';
import type { FamilyMember, FamilyRole } from '../types';

export interface AgentActionCompletion {
  actionType: string;
  resources: AgentResource[];
}

export interface AgentResultNavigationTarget {
  gatheringId?: string;
  startAt?: string;
}

interface AssistantProps {
  presetInput: string;
  clearPreset: () => void;
  familyId?: string;
  members: FamilyMember[];
  familyRole?: FamilyRole;
  isActive?: boolean;
  onActionCompleted?: (completion: AgentActionCompletion) => Promise<void> | void;
  onNavigateToActionResult?: (actionType: string, target?: AgentResultNavigationTarget) => void;
  onUseReconnectionPlan: (prefill: GatheringPlanPrefill) => void;
}

interface ActionProposal {
  id: string;
  actionType: AgentActionType;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  warnings?: string[];
}

interface AgentGatheringPlannerPayload extends GatheringPlannerPrefill {
  startAt: string;
  timezone: 'Asia/Dubai';
  invitationChannel: 'share_link' | 'whatsapp';
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  kind?: 'message' | 'clarification' | 'proposal' | 'result' | 'gathering_planner';
  proposal?: ActionProposal;
  proposalStatus?: 'pending' | 'confirmed' | 'rejected' | 'expired';
  completedActionType?: string;
  planner?: AgentGatheringPlannerPayload;
  plannerStatus?: 'ready' | 'dismissed' | 'saved' | 'links_pending';
  plannerResult?: StoredPlannerResult;
}

interface AgentResponse {
  sessionId: string;
  messageId?: string;
  kind: 'message' | 'clarification' | 'proposal' | 'gathering_planner';
  message: string;
  proposal?: ActionProposal;
  planner?: AgentGatheringPlannerPayload;
}

function BodyPortal({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? children : createPortal(children, document.body);
}

interface RestoredAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'message' | 'clarification' | 'proposal' | 'result' | 'gathering_planner';
  message: string;
  proposal?: ActionProposal;
  proposalStatus?: 'pending' | 'confirmed' | 'rejected' | 'expired';
  planner?: AgentGatheringPlannerPayload;
  createdAt: string;
}

interface AgentConversationResponse {
  sessionId: string;
  messages: RestoredAgentMessage[];
}

interface AgentProposalResolutionResponse {
  proposalId: string;
  actionType: AgentActionType;
  status: 'confirmed' | 'rejected';
  message?: string;
  result?: unknown;
  alreadyCompleted?: boolean;
  alreadyRejected?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canonicalDubaiMinutePattern = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:00\+04:00$/;
const restoredMessageKinds = new Set(['message', 'clarification', 'proposal', 'result', 'gathering_planner']);

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

function isSafeActionProposal(value: unknown): value is ActionProposal {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(['id', 'actionType', 'title', 'summary', 'details', 'warnings']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) return false;
  if (
    typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || !isKnownAgentActionType(value.actionType)
    || !isBoundedText(value.title, 1, 500)
    || !isBoundedText(value.summary, 1, 2_000)
  ) return false;
  if (value.details !== undefined && !isRecord(value.details)) return false;
  return value.warnings === undefined
    || (
      Array.isArray(value.warnings)
      && value.warnings.length <= 100
      && value.warnings.every(warning => isBoundedText(warning, 1, 2_000))
    );
}

function isProposalStatus(value: unknown): value is NonNullable<AgentMessage['proposalStatus']> {
  return value === 'pending' || value === 'confirmed' || value === 'rejected' || value === 'expired';
}

function isSafeGatheringPlannerPayload(value: unknown): value is AgentGatheringPlannerPayload {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    'title',
    'purpose',
    'startAt',
    'timezone',
    'locationName',
    'type',
    'notes',
    'memberIds',
    'invitationChannel',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) return false;
  const scheduleMatch = typeof value.startAt === 'string'
    ? canonicalDubaiMinutePattern.exec(value.startAt)
    : null;
  const parsedStartAt = scheduleMatch ? new Date(value.startAt as string) : undefined;
  if (
    !isBoundedText(value.title, 2, 120)
    || !isBoundedText(value.purpose, 2, 500)
    || !scheduleMatch
    || !parsedStartAt
    || Number.isNaN(parsedStartAt.getTime())
    || formatDubaiDateKey(parsedStartAt) !== scheduleMatch[1]
    || value.timezone !== 'Asia/Dubai'
    || !isBoundedText(value.locationName, 2, 300)
    || typeof value.type !== 'string'
    || !(GATHERING_TYPES as readonly string[]).includes(value.type)
    || !Array.isArray(value.memberIds)
    || value.memberIds.length > 200
    || value.memberIds.some(memberId => typeof memberId !== 'string' || !uuidPattern.test(memberId))
    || new Set(value.memberIds).size !== value.memberIds.length
    || (value.invitationChannel !== 'share_link' && value.invitationChannel !== 'whatsapp')
  ) return false;
  return value.notes === undefined || isBoundedText(value.notes, 1, 2_000);
}

function isSafeRestoredAgentMessage(value: unknown): value is RestoredAgentMessage {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    'id', 'role', 'kind', 'message', 'proposal', 'proposalStatus', 'planner', 'createdAt',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) return false;
  if (
    !isBoundedText(value.id, 1, 200)
    || (value.role !== 'user' && value.role !== 'assistant')
    || typeof value.kind !== 'string'
    || !restoredMessageKinds.has(value.kind)
    || !isBoundedText(value.message, 1, 2_000)
    || typeof value.createdAt !== 'string'
    || Number.isNaN(new Date(value.createdAt).getTime())
  ) return false;
  if (value.kind === 'proposal') {
    return uuidPattern.test(value.id)
      && value.role === 'assistant'
      && isSafeActionProposal(value.proposal)
      && isProposalStatus(value.proposalStatus)
      && value.planner === undefined;
  }
  if (value.kind === 'gathering_planner') {
    return uuidPattern.test(value.id)
      && value.role === 'assistant'
      && isSafeGatheringPlannerPayload(value.planner)
      && value.proposal === undefined
      && value.proposalStatus === undefined;
  }
  return value.proposal === undefined && value.planner === undefined && value.proposalStatus === undefined;
}

function sanitizeRestoredAgentMessage(value: unknown): RestoredAgentMessage | undefined {
  if (isSafeRestoredAgentMessage(value)) return value;
  if (!isRecord(value)) return undefined;
  if (
    !isBoundedText(value.id, 1, 200)
    || (value.role !== 'user' && value.role !== 'assistant')
    || !isBoundedText(value.message, 1, 2_000)
    || typeof value.createdAt !== 'string'
    || Number.isNaN(new Date(value.createdAt).getTime())
  ) return undefined;
  // Preserve readable transcript text, but strip every action/planner control
  // from a malformed restored envelope.
  return {
    id: value.id,
    role: value.role,
    kind: 'message',
    message: value.message,
    createdAt: value.createdAt,
  };
}

function isSafeLiveAgentResponse(value: unknown): value is AgentResponse {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(['sessionId', 'messageId', 'kind', 'message', 'proposal', 'planner']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) return false;
  if (
    typeof value.sessionId !== 'string'
    || !uuidPattern.test(value.sessionId)
    || (value.kind !== 'message'
      && value.kind !== 'clarification'
      && value.kind !== 'proposal'
      && value.kind !== 'gathering_planner')
    || !isBoundedText(value.message, 1, 2_000)
    || (value.messageId !== undefined && (typeof value.messageId !== 'string' || !uuidPattern.test(value.messageId)))
  ) return false;
  if (value.kind === 'proposal') {
    return isSafeActionProposal(value.proposal) && value.planner === undefined;
  }
  if (value.kind === 'gathering_planner') {
    return typeof value.messageId === 'string'
      && uuidPattern.test(value.messageId)
      && isSafeGatheringPlannerPayload(value.planner)
      && value.proposal === undefined;
  }
  return value.proposal === undefined && value.planner === undefined;
}

function isSafeProposalResolutionResponse(value: unknown): value is AgentProposalResolutionResponse {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    'proposalId',
    'actionType',
    'status',
    'message',
    'result',
    'alreadyCompleted',
    'alreadyRejected',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) return false;
  return typeof value.proposalId === 'string'
    && uuidPattern.test(value.proposalId)
    && isKnownAgentActionType(value.actionType)
    && (value.status === 'confirmed' || value.status === 'rejected')
    && (value.message === undefined || isBoundedText(value.message, 1, 2_000))
    && (value.alreadyCompleted === undefined || typeof value.alreadyCompleted === 'boolean')
    && (value.alreadyRejected === undefined || typeof value.alreadyRejected === 'boolean');
}

interface AgentErrorNotice {
  phase: 'request' | 'confirmation' | 'refresh' | 'conversation';
  outcome: 'unchanged' | 'unknown' | 'completed';
  title: string;
  message: string;
  consequence: string;
}

function requestErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
}

function proposalResolutionError(caught: unknown, decision: 'confirm' | 'reject'): AgentErrorNotice {
  const message = requestErrorMessage(caught, 'The proposal could not be updated.');
  if (decision === 'reject') {
    return {
      phase: 'confirmation',
      outcome: 'unchanged',
      title: 'Cancellation could not be verified',
      message,
      consequence: 'No family change was requested, but this proposal may still be pending. Leave it unchanged until the server is reachable.',
    };
  }

  const outcomeUnknown = !(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500;
  return outcomeUnknown
    ? {
        phase: 'confirmation',
        outcome: 'unknown',
        title: 'Confirmation outcome is unknown',
        message,
        consequence: 'The server may have completed this action. Check the relevant app screen, or use the dedicated status-check button below; it reads the idempotent confirmation result instead of proposing a new action.',
      }
    : {
        phase: 'confirmation',
        outcome: 'unchanged',
        title: 'Confirmation was rejected',
        message,
        consequence: 'The server rejected this confirmation, so no family data was changed by this attempt.',
      };
}

const welcomeMessage: AgentMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'How can I help your family today?',
};

const agentSessionKey = (familyId: string) => `family-companion:agent-session:${familyId}`;
const plannerStateKey = (familyId: string) => `family-companion:agent-planners:${familyId}`;

interface StoredPlannerState {
  dismissed: string[];
  saved: string[];
  results: Record<string, StoredPlannerResult>;
}

interface StoredPlannerResult {
  gatheringId: string;
  startAt: string;
  linksPending: boolean;
}

function readStoredPlannerState(familyId: string): StoredPlannerState {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(plannerStateKey(familyId)) || '{}') as Partial<StoredPlannerState>;
    const results = Object.fromEntries(
      Object.entries(parsed.results && typeof parsed.results === 'object' ? parsed.results : {})
        .slice(-100)
        .filter((entry): entry is [string, StoredPlannerResult] => {
          const [messageId, value] = entry;
          return Boolean(
            messageId
            && value
            && typeof value === 'object'
            && typeof value.gatheringId === 'string'
            && typeof value.startAt === 'string'
            && !Number.isNaN(new Date(value.startAt).getTime())
            && typeof value.linksPending === 'boolean',
          );
        }),
    );
    return {
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter(value => typeof value === 'string') : [],
      saved: Array.isArray(parsed.saved) ? parsed.saved.filter(value => typeof value === 'string') : [],
      results,
    };
  } catch {
    return { dismissed: [], saved: [], results: {} };
  }
}

function writeStoredPlannerState(familyId: string, state: StoredPlannerState): void {
  try {
    window.sessionStorage.setItem(plannerStateKey(familyId), JSON.stringify(state));
  } catch {
    // Private browsing/storage policies may disable sessionStorage. The
    // server-owned conversation remains the source of truth.
  }
}

function rememberSession(familyId: string, nextSessionId: string): void {
  try {
    window.sessionStorage.setItem(agentSessionKey(familyId), nextSessionId);
  } catch {
    // The live in-memory session still works when browser storage is blocked.
  }
}

function forgetSession(familyId: string): void {
  try {
    window.sessionStorage.removeItem(agentSessionKey(familyId));
    window.sessionStorage.removeItem(plannerStateKey(familyId));
  } catch {
    // Nothing else is required; the server still enforces session ownership.
  }
}

export function clearStoredAgentSessions(): void {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('family-companion:agent-session:') || key?.startsWith('family-companion:agent-planners:')) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Server authorization still prevents another signed-in user from loading
    // a conversation even if browser storage cannot be cleared.
  }
}

export function Assistant({
  presetInput,
  clearPreset,
  familyId,
  members,
  familyRole = 'member',
  isActive = true,
  onActionCompleted,
  onNavigateToActionResult,
  onUseReconnectionPlan,
}: AssistantProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([welcomeMessage]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [activeProposalId, setActiveProposalId] = useState<string>();
  const [activePlannerMessageId, setActivePlannerMessageId] = useState<string>();
  const [activePlannerStage, setActivePlannerStage] = useState<GatheringPlannerStage>('details');
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [uncertainProposalIds, setUncertainProposalIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<AgentErrorNotice>();
  const [planRefreshVersion, setPlanRefreshVersion] = useState(0);
  const [aiProcessingConsent, setAiProcessingConsent] = useState(false);
  const [showConsentDetails, setShowConsentDetails] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [ephemeralInvitationLinks, setEphemeralInvitationLinks] = useState<EphemeralInvitationLinks>();
  const plannerScrollRootRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeFamilyIdRef = useRef(familyId);
  const activeSessionIdRef = useRef(sessionId);
  const activePlannerMessageIdRef = useRef(activePlannerMessageId);
  const isActiveRef = useRef(isActive);
  const mountedRef = useRef(false);
  activeFamilyIdRef.current = familyId;
  activeSessionIdRef.current = sessionId;
  activePlannerMessageIdRef.current = activePlannerMessageId;
  isActiveRef.current = isActive;
  const quickPrompts = getAgentQuickPrompts(familyRole);
  const roleNotice = getAgentRoleNotice(familyRole);
  const isCurrentConversationContext = (expectedFamilyId: string, expectedSessionId: string) => (
    mountedRef.current
    && activeFamilyIdRef.current === expectedFamilyId
    && activeSessionIdRef.current === expectedSessionId
  );
  const isCurrentOpenPlannerContext = (
    expectedFamilyId: string,
    expectedSessionId: string,
    expectedMessageId: string,
  ) => isActiveRef.current
    && isCurrentConversationContext(expectedFamilyId, expectedSessionId)
    && activePlannerMessageIdRef.current === expectedMessageId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isRestoring]);

  useEffect(() => {
    if (!presetInput) return;
    setInput(presetInput);
    clearPreset();
  }, [clearPreset, presetInput]);

  useEffect(() => {
    // Assistant transcripts, proposals, and planners are family-scoped. Reset
    // the in-memory view before optionally restoring the newly selected
    // family's owned server session.
    setMessages([welcomeMessage]);
    setSessionId(undefined);
    setIsLoading(false);
    setIsRestoring(false);
    setActiveProposalId(undefined);
    setActivePlannerMessageId(undefined);
    setActivePlannerStage('details');
    setPlannerBusy(false);
    setUncertainProposalIds(new Set());
    setError(undefined);
    setAiProcessingConsent(false);
    setShowConsentDetails(false);
    setComposerFocused(false);
    setEphemeralInvitationLinks(undefined);
  }, [familyId]);

  useEffect(() => {
    if (!familyId) return;
    let storedSessionId = '';
    try {
      storedSessionId = window.sessionStorage.getItem(agentSessionKey(familyId)) || '';
    } catch {
      return;
    }
    if (!storedSessionId) return;
    if (!uuidPattern.test(storedSessionId)) {
      forgetSession(familyId);
      return;
    }

    let current = true;
    setIsRestoring(true);
    apiRequest<unknown>(
      `/api/agent/sessions/${encodeURIComponent(storedSessionId)}/messages?familyId=${encodeURIComponent(familyId)}`,
    ).then((rawConversation) => {
      if (!current) return;
      if (
        !isRecord(rawConversation)
        || rawConversation.sessionId !== storedSessionId
        || !Array.isArray(rawConversation.messages)
      ) throw new Error('The saved AI conversation returned an invalid response.');
      const conversation: AgentConversationResponse = {
        sessionId: storedSessionId,
        messages: rawConversation.messages
          .map(sanitizeRestoredAgentMessage)
          .filter((message): message is RestoredAgentMessage => Boolean(message)),
      };
      const localPlannerState = readStoredPlannerState(familyId);
      const dismissed = new Set(localPlannerState.dismissed);
      const saved = new Set(localPlannerState.saved);
      const restoredMessages: AgentMessage[] = conversation.messages.map((message) => {
        const plannerResult = localPlannerState.results[message.id];
        const restoredProposal = message.kind === 'proposal' ? message.proposal : undefined;
        return {
          id: message.id,
          role: message.role,
          kind: message.kind === 'proposal' && !restoredProposal ? 'message' : message.kind,
          text: message.message,
          ...(restoredProposal ? {
            proposal: restoredProposal,
            proposalStatus: message.proposalStatus,
          } : {}),
          ...(message.planner ? {
            planner: message.planner,
            plannerStatus: plannerResult?.linksPending
              ? 'links_pending' as const
              : saved.has(message.id)
                ? 'saved' as const
                : dismissed.has(message.id)
                  ? 'dismissed' as const
                  : 'ready' as const,
            ...(plannerResult ? { plannerResult } : {}),
          } : {}),
        };
      });
      setSessionId(conversation.sessionId);
      setMessages([welcomeMessage, ...restoredMessages]);
      const plannerToOpen = [...restoredMessages]
        .reverse()
        .find(message => message.planner && message.plannerStatus === 'ready');
      setActivePlannerMessageId(isActiveRef.current ? plannerToOpen?.id : undefined);
      setActivePlannerStage('details');
    }).catch((caught) => {
      if (!current) return;
      if (caught instanceof ApiError && caught.status === 404) {
        forgetSession(familyId);
        setSessionId(undefined);
        setMessages([welcomeMessage]);
        return;
      }
      setError({
        phase: 'conversation',
        outcome: 'unchanged',
        title: 'Conversation could not be restored',
        message: requestErrorMessage(caught, 'The saved AI conversation is currently unavailable.'),
        consequence: 'No family data was changed. You can still start a new conversation after deleting the unavailable one.',
      });
    }).finally(() => {
      if (current) setIsRestoring(false);
    });

    return () => {
      current = false;
    };
  }, [familyId]);

  useEffect(() => {
    if (!isActive) {
      // Private invitation URLs can also live inside GatheringPlanner state.
      // Unmount the child when the Assistant is hidden so returning to this
      // tab cannot reveal a previous one-time result.
      setEphemeralInvitationLinks(undefined);
      setActivePlannerMessageId(undefined);
      setActivePlannerStage('details');
      setPlannerBusy(false);
      setComposerFocused(false);
    }
  }, [isActive]);

  const sendMessage = async (overrideInput?: string) => {
    const messageText = (overrideInput ?? input).trim();
    if (!messageText || isLoading || isRestoring || !familyId) return;
    const requestFamilyId = familyId;
    if (!aiProcessingConsent) {
      setError({
        phase: 'request',
        outcome: 'unchanged',
        title: 'Approval needed',
        message: 'Review and accept the Gemini data disclosure for this request.',
        consequence: 'Nothing was sent to Gemini and no family data was changed.',
      });
      return;
    }

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: messageText,
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError(undefined);
    setIsLoading(true);

    try {
      const rawBody = await apiRequest<unknown>('/api/agent/messages', {
        method: 'POST',
        body: JSON.stringify({ familyId: requestFamilyId, sessionId, message: messageText, aiProcessingConsent: true }),
      });
      // Ignore a late response after the user has switched families. The
      // response remains stored only in its server-authorized family session.
      if (activeFamilyIdRef.current !== requestFamilyId) return;
      if (!isSafeLiveAgentResponse(rawBody)) {
        throw new Error('The family agent returned an invalid response.');
      }
      const body = rawBody;

      setSessionId(body.sessionId);
      rememberSession(requestFamilyId, body.sessionId);
      const assistantMessageId = body.messageId || `assistant-${Date.now()}`;
      setMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: 'assistant',
          kind: body.kind,
          text: body.message,
          proposal: body.proposal,
          proposalStatus: body.proposal ? 'pending' : undefined,
          planner: body.kind === 'gathering_planner' ? body.planner : undefined,
          plannerStatus: body.kind === 'gathering_planner' ? 'ready' : undefined,
        },
      ]);
      if (body.kind === 'gathering_planner') {
        setActivePlannerStage('details');
        setActivePlannerMessageId(isActiveRef.current ? body.messageId! : undefined);
      }
    } catch (requestError) {
      if (activeFamilyIdRef.current !== requestFamilyId) return;
      setError({
        phase: 'request',
        outcome: 'unchanged',
        title: 'Agent request failed',
        message: requestErrorMessage(requestError, 'The family agent is currently unavailable.'),
        consequence: 'No family data was changed by this request.',
      });
    } finally {
      if (activeFamilyIdRef.current === requestFamilyId) {
        setIsLoading(false);
        setAiProcessingConsent(false);
        setShowConsentDetails(false);
      }
    }
  };

  const resolveProposal = async (
    proposal: ActionProposal,
    decision: 'confirm' | 'reject',
    options: { statusCheck?: boolean } = {},
  ) => {
    const proposalId = proposal.id;
    const requestFamilyId = familyId;
    const requestSessionId = sessionId;
    if (!requestFamilyId || !requestSessionId || !isKnownAgentActionType(proposal.actionType)) {
      setError({
        phase: 'confirmation',
        outcome: 'unchanged',
        title: 'Proposal cannot be verified',
        message: 'This proposal is not bound to the active family conversation.',
        consequence: 'No family data was changed.',
      });
      return;
    }
    const isCurrentRequest = () => mountedRef.current
      && activeFamilyIdRef.current === requestFamilyId
      && activeSessionIdRef.current === requestSessionId;
    if (decision === 'confirm' && !canRoleConfirmAgentAction(proposal.actionType, familyRole)) {
      setError({
        phase: 'confirmation',
        outcome: 'unchanged',
        title: 'Approval not permitted',
        message: 'Your family role cannot approve this action. The server will not perform it.',
        consequence: 'No family data was changed.',
      });
      return;
    }
    if (
      decision === 'confirm'
      && !options.statusCheck
      && isDestructiveAgentAction(proposal.actionType)
      && !window.confirm(buildDestructiveAgentConfirmation(proposal))
    ) {
      return;
    }

    if (decision === 'confirm' && !options.statusCheck && proposal.actionType === 'PREPARE_INVITATION_LINKS') {
      // Old tokens may be invalid after a successful rotation. Never leave a
      // potentially stale private URL visible while a replacement is pending.
      setEphemeralInvitationLinks(undefined);
    }

    setActiveProposalId(proposalId);
    setError(undefined);

    try {
      const rawBody = await apiRequest<unknown>(`/api/agent/action-proposals/${encodeURIComponent(proposalId)}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ expectedActionType: proposal.actionType }),
      });
      if (!isCurrentRequest()) return;
      if (!isSafeProposalResolutionResponse(rawBody)) {
        throw new Error('The proposal result returned an invalid response.');
      }
      const body = rawBody;
      const expectedStatus = decision === 'confirm' ? 'confirmed' : 'rejected';
      if (
        body.proposalId !== proposalId
        || body.actionType !== proposal.actionType
        || body.status !== expectedStatus
      ) {
        throw new Error('The proposal result did not match the action shown for approval.');
      }

      setMessages((current) => current.map((message) => (
        message.proposal?.id === proposalId
          ? { ...message, proposalStatus: decision === 'confirm' ? 'confirmed' : 'rejected' }
          : message
      )).concat({
        id: `result-${Date.now()}`,
        role: 'assistant',
        text: body.message || (decision === 'confirm' ? 'The approved change was completed.' : 'The proposed change was cancelled. No family data was changed.'),
        completedActionType: decision === 'confirm' ? proposal.actionType : undefined,
      }));
      setUncertainProposalIds((current) => {
        const next = new Set(current);
        next.delete(proposalId);
        return next;
      });

      if (decision === 'confirm') {
        const preparedLinks = extractEphemeralInvitationLinks(proposal.actionType, body.result);
        if (preparedLinks) setEphemeralInvitationLinks(preparedLinks);
        if (proposal.actionType === 'PREPARE_INVITATION_LINKS' && !preparedLinks) {
          setError({
            phase: 'confirmation',
            outcome: 'completed',
            title: 'Private links are not available in this result',
            message: invitationLinksUnavailableMessage(Boolean(body.alreadyCompleted)),
            consequence: 'The invitation action is complete. Its private URLs are intentionally not recoverable from the conversation or a repeated confirmation.',
          });
        }

        const resources = getAgentActionResources(proposal.actionType);
        if (resources.includes('plans')) {
          setPlanRefreshVersion((current) => current + 1);
        }
        try {
          await onActionCompleted?.({ actionType: proposal.actionType, resources });
        } catch {
          if (!isCurrentRequest()) return;
          setError({
            phase: 'refresh',
            outcome: 'completed',
            title: 'Change completed; refresh failed',
            message: 'Another screen could not refresh automatically. Open that screen and use Refresh.',
            consequence: 'The approved action completed. Only the follow-up screen refresh failed.',
          });
        }
      }
    } catch (requestError) {
      if (!isCurrentRequest()) return;
      const notice = proposalResolutionError(requestError, decision);
      setError(notice);
      if (decision === 'confirm' && notice.outcome === 'unknown') {
        setUncertainProposalIds((current) => new Set(current).add(proposalId));
      }
    } finally {
      if (isCurrentRequest()) setActiveProposalId(undefined);
    }
  };

  const setPlannerStatus = (
    messageId: string,
    status: 'dismissed' | 'saved' | 'links_pending',
    result?: StoredPlannerResult,
  ) => {
    setMessages(current => current.map(message => (
      message.id === messageId
        ? { ...message, plannerStatus: status, ...(result ? { plannerResult: result } : {}) }
        : message
    )));
    if (!familyId) return;
    const stored = readStoredPlannerState(familyId);
    const dismissed = new Set(stored.dismissed);
    const saved = new Set(stored.saved);
    const results = { ...stored.results };
    if (status === 'saved' || status === 'links_pending') {
      saved.add(messageId);
      dismissed.delete(messageId);
      if (result) results[messageId] = result;
    } else if (!saved.has(messageId)) {
      dismissed.add(messageId);
      delete results[messageId];
    }
    writeStoredPlannerState(familyId, {
      dismissed: [...dismissed].slice(-100),
      saved: [...saved].slice(-100),
      results: Object.fromEntries(Object.entries(results).slice(-100)),
    });
  };

  const closeActivePlanner = () => {
    if (!activePlannerMessageId || plannerBusy) return;
    const plannerMessage = messages.find(message => message.id === activePlannerMessageId);
    if (plannerMessage?.plannerStatus !== 'saved' && plannerMessage?.plannerStatus !== 'links_pending') {
      setPlannerStatus(activePlannerMessageId, 'dismissed');
    }
    setActivePlannerMessageId(undefined);
    setActivePlannerStage('details');
  };

  const openPlanner = (messageId: string) => {
    const plannerMessage = messages.find(message => message.id === messageId);
    if (
      !plannerMessage?.planner
      || plannerMessage.plannerStatus === 'saved'
      || plannerMessage.plannerStatus === 'links_pending'
    ) return;
    setMessages(current => current.map(message => (
      message.id === messageId ? { ...message, plannerStatus: 'ready' } : message
    )));
    if (familyId) {
      const stored = readStoredPlannerState(familyId);
      writeStoredPlannerState(familyId, {
        ...stored,
        dismissed: stored.dismissed.filter(id => id !== messageId),
      });
    }
    setActivePlannerStage('details');
    setActivePlannerMessageId(messageId);
  };

  const handlePlannerGatheringChanged = async (requestFamilyId: string, requestSessionId: string) => {
    try {
      await onActionCompleted?.({ actionType: 'CREATE_GATHERING_DRAFT', resources: ['gatherings'] });
    } catch {
      if (!isCurrentConversationContext(requestFamilyId, requestSessionId)) return;
      setError({
        phase: 'refresh',
        outcome: 'completed',
        title: 'Gathering saved; refresh failed',
        message: 'The Calendar could not refresh automatically. Open it and use Refresh.',
        consequence: 'The gathering was created exactly once. Only the follow-up screen refresh failed.',
      });
    }
  };

  const handlePlannerSubmissionResult = (messageId: string, result: GatheringPlannerSubmissionResult) => {
    setPlannerStatus(
      messageId,
      result.invitationError ? 'links_pending' : 'saved',
      {
        gatheringId: result.gathering.id,
        startAt: result.gathering.startAt,
        linksPending: Boolean(result.invitationError),
      },
    );
  };

  const handlePlannerStageChange = (stage: GatheringPlannerStage) => {
    setActivePlannerStage(stage);
  };

  const viewPlannerResultInCalendar = (gathering: PersistentGathering) => {
    setActivePlannerMessageId(undefined);
    setActivePlannerStage('details');
    onNavigateToActionResult?.('CREATE_GATHERING_DRAFT', {
      gatheringId: gathering.id,
      startAt: gathering.startAt,
    });
  };

  const viewPlannerMessageInCalendar = (message: AgentMessage) => {
    onNavigateToActionResult?.('CREATE_GATHERING_DRAFT', {
      ...(message.plannerResult?.gatheringId ? { gatheringId: message.plannerResult.gatheringId } : {}),
      startAt: message.plannerResult?.startAt ?? message.planner?.startAt,
    });
  };

  const deleteConversation = async () => {
    if (!sessionId || !window.confirm('Permanently delete this AI conversation and its pending proposals?')) return;
    const requestFamilyId = familyId;
    const requestSessionId = sessionId;
    if (!requestFamilyId) return;
    const isCurrentRequest = () => mountedRef.current
      && activeFamilyIdRef.current === requestFamilyId
      && activeSessionIdRef.current === requestSessionId;
    setIsLoading(true);
    setError(undefined);
    try {
      await apiRequest<void>(`/api/agent/sessions/${encodeURIComponent(requestSessionId)}`, { method: 'DELETE' });
      if (!isCurrentRequest()) return;
      setIsLoading(false);
      setSessionId(undefined);
      setMessages([welcomeMessage]);
      setUncertainProposalIds(new Set());
      setActivePlannerMessageId(undefined);
      setActivePlannerStage('details');
      setPlannerBusy(false);
      setInput('');
      setAiProcessingConsent(false);
      setShowConsentDetails(false);
      setEphemeralInvitationLinks(undefined);
      forgetSession(requestFamilyId);
    } catch (requestError) {
      if (!isCurrentRequest()) return;
      setError({
        phase: 'conversation',
        outcome: 'unknown',
        title: 'Conversation deletion could not be verified',
        message: requestErrorMessage(requestError, 'The conversation could not be deleted.'),
        consequence: 'Family records were not changed. The conversation may already have been deleted if the connection failed after the server acted.',
      });
    } finally {
      if (isCurrentRequest()) setIsLoading(false);
    }
  };

  const activePlannerMessage = activePlannerMessageId
    ? messages.find(message => message.id === activePlannerMessageId && message.planner)
    : undefined;
  const plannerDialogRef = useModalFocusTrap<HTMLDivElement>({
    active: Boolean(activePlannerMessage?.planner && familyId),
    onEscape: closeActivePlanner,
    escapeDisabled: plannerBusy,
    scrollRoot: plannerScrollRootRef,
  });

  return (
    <div
      ref={(element: HTMLDivElement | null) => {
        plannerScrollRootRef.current = element?.closest<HTMLElement>('main') ?? null;
      }}
      className="assistant-mobile-shell flex h-full min-h-0 flex-1 flex-col"
      data-testid="assistant-mobile-shell"
      data-composer-focused={composerFocused ? 'true' : 'false'}
    >
      <header className="assistant-mobile-optional mb-1 flex min-h-9 shrink-0 items-center justify-between sm:hidden">
        <p className="text-[11px] font-medium text-ink/50">Private, review-first family support</p>
        <span className="flex size-8 items-center justify-center rounded-full border border-sepia bg-white text-gold" aria-hidden="true">
          <Bot size={16} />
        </span>
      </header>

      <details className="assistant-mobile-optional assistant-safety-panel group mb-2 shrink-0 overflow-hidden rounded-2xl border border-gold/20 bg-gold/10 text-ink">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-ink [&::-webkit-details-marker]:hidden">
          <ShieldCheck className="shrink-0 text-gold" size={17} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-ink">Confirm before anything changes</span>
            <span className="block text-[11px] text-ink/55">Safety and conversation controls</span>
          </span>
          <span className="text-[11px] font-bold text-gold-ink group-open:hidden">Read</span>
          <span className="hidden text-[11px] font-bold text-gold-ink group-open:inline">Close</span>
        </summary>
        <div className="border-t border-gold/15 px-3 pb-3 pt-2">
          <p className="text-xs leading-relaxed text-ink/65">
            The model may suggest actions, but validated server code performs them only after you approve the exact change.
          </p>
          {sessionId && (
            <button
              type="button"
              onClick={() => void deleteConversation()}
              disabled={isLoading || isRestoring}
              className="mt-2 min-h-11 rounded-xl border border-gold/30 px-3 text-xs font-bold tracking-wide text-ink/55 hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:opacity-40"
            >
              Delete conversation
            </button>
          )}
        </div>
      </details>

      {!familyId && (
        <div className="mb-2 flex shrink-0 items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-red-700" role="alert">
          <AlertCircle size={18} />
          <p className="text-xs font-semibold">Sign in and select a family before using the agent.</p>
        </div>
      )}

      {familyId && roleNotice && (
        <div className="mb-2 flex shrink-0 items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800" role="status">
          <AlertCircle size={18} />
          <p className="text-xs font-semibold">{roleNotice}</p>
        </div>
      )}

      {familyId ? (
        <div className="assistant-mobile-optional assistant-reconnection-panel mb-2 shrink-0">
          <ReconnectionPlansPanel
            familyId={familyId}
            members={members}
            refreshVersion={planRefreshVersion}
            onUsePlan={onUseReconnectionPlan}
          />
        </div>
      ) : null}

      {ephemeralInvitationLinks ? (
        <PreparedInvitationLinks
          prepared={ephemeralInvitationLinks}
          onDismiss={() => setEphemeralInvitationLinks(undefined)}
          onContinue={onNavigateToActionResult ? () => {
            setEphemeralInvitationLinks(undefined);
            onNavigateToActionResult('PREPARE_INVITATION_LINKS');
          } : undefined}
        />
      ) : null}

      {error && (
        <div className="mb-2 flex shrink-0 items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-red-700" role="alert" data-agent-error-phase={error.phase}>
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="text-xs font-bold">{error.title}</p>
            <p className="mt-1 text-xs leading-relaxed">{error.message}</p>
            <p className="mt-1 text-[10px] text-red-600/80">{error.consequence}</p>
          </div>
        </div>
      )}

      <div className="mb-2 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 custom-scrollbar sm:space-y-5 sm:pr-2" aria-live="polite" data-testid="assistant-message-list">
        {messages.map((message) => (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            key={message.id}
            className={cn('flex max-w-[96%] items-start gap-2 sm:max-w-[88%] sm:gap-3', message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto')}
            data-agent-message={message.id === 'welcome' ? 'welcome' : message.role}
            data-agent-speaker={message.role}
            role="article"
            aria-label={message.role === 'user' ? 'Your message' : 'AI Helper message'}
          >
            {message.role === 'user' ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-ink bg-ink text-white shadow-sm sm:size-9" aria-hidden="true">
                <span className="text-[9px] font-bold">You</span>
              </div>
            ) : null}
            <div className="min-w-0 flex-1 space-y-3">
              <div className={cn(
                'whitespace-pre-wrap rounded-2xl p-3.5 text-sm leading-relaxed shadow-sm sm:rounded-3xl sm:p-5',
                message.role === 'user'
                  ? 'rounded-tr-none bg-ink text-white'
                  : 'rounded-tl-none border border-sepia bg-white text-ink',
              )}>
                {message.text}
                {message.id === 'welcome' ? (
                  <details className="mt-2 whitespace-normal border-t border-sepia/60 pt-2">
                    <summary className="min-h-11 cursor-pointer py-2 text-xs font-bold text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">How it works</summary>
                    <p className="pb-1 text-xs leading-relaxed text-ink/60">{agentWelcomeText}</p>
                  </details>
                ) : null}
                {message.completedActionType && message.completedActionType !== 'PREPARE_INVITATION_LINKS' && getAgentResultDestinationLabel(message.completedActionType) && onNavigateToActionResult ? (
                  <button
                    type="button"
                    onClick={() => onNavigateToActionResult(message.completedActionType!)}
                    className="mt-3 flex min-h-11 items-center gap-1.5 text-[11px] font-bold tracking-wide text-gold-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
                  >
                    {getAgentResultDestinationLabel(message.completedActionType)} <ArrowRight size={12} />
                  </button>
                ) : null}
              </div>

              {message.proposal && (
                <div className="rounded-2xl border border-gold/35 bg-white p-4 shadow-md sm:rounded-3xl sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold tracking-wide text-gold-ink">Proposed action</p>
                      <h3 className="mt-1 font-serif text-base font-bold italic text-ink sm:text-lg">{message.proposal.title}</h3>
                    </div>
                    <span className="rounded-full bg-sand px-3 py-1 text-[10px] font-bold tracking-wide text-ink/50">
                      {humanizeAgentLabel(message.proposal.actionType)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink/65">{message.proposal.summary}</p>

                  {message.proposal.details && Object.keys(message.proposal.details).length > 0 && (
                    <dl className="mt-4 divide-y divide-sepia/40 overflow-hidden rounded-2xl border border-sepia/50">
                      {Object.entries(message.proposal.details).map(([label, value]) => (
                        <div key={label} className="grid grid-cols-1 gap-1 px-4 py-2.5 text-xs min-[400px]:grid-cols-[7rem_1fr] min-[400px]:gap-3 sm:grid-cols-[8rem_1fr]">
                          <dt className="font-bold text-ink/45">{humanizeAgentLabel(label)}</dt>
                          <dd className="break-words text-ink">{formatAgentDetail(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {message.proposal.warnings?.map((warning) => (
                    <p key={warning} className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-amber-700">
                      <AlertCircle className="mt-0.5 shrink-0" size={13} /> {warning}
                    </p>
                  ))}

                  {message.proposalStatus === 'pending' ? (
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                      {uncertainProposalIds.has(message.proposal.id) ? (
                        <button
                          type="button"
                          disabled={Boolean(activeProposalId)}
                          onClick={() => void resolveProposal(message.proposal!, 'confirm', { statusCheck: true })}
                          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-[11px] font-bold tracking-wide text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                        >
                          {activeProposalId === message.proposal.id ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}
                          Check confirmation status
                        </button>
                      ) : canRoleConfirmAgentAction(message.proposal.actionType, familyRole) ? (
                        <button
                          type="button"
                          disabled={Boolean(activeProposalId)}
                          onClick={() => void resolveProposal(message.proposal!, 'confirm')}
                          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-[11px] font-bold tracking-wide text-white transition-colors hover:bg-gold-ink disabled:opacity-40"
                        >
                          {activeProposalId === message.proposal.id ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}
                          {getAgentConfirmButtonLabel(message.proposal.actionType)}
                        </button>
                      ) : (
                        <p className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] font-semibold leading-relaxed text-amber-800">
                          Your role cannot approve this action. A family owner or administrator must make this change.
                        </p>
                      )}
                      {!uncertainProposalIds.has(message.proposal.id) ? (
                        <button
                          type="button"
                          disabled={Boolean(activeProposalId)}
                          onClick={() => void resolveProposal(message.proposal!, 'reject')}
                          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-sepia px-4 text-[11px] font-bold tracking-wide text-ink/60 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                        >
                          <X size={15} /> Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className={cn(
                      'mt-4 flex min-h-11 items-center gap-2 rounded-xl px-4 py-3 text-[11px] font-bold tracking-wide',
                      message.proposalStatus === 'confirmed'
                        ? 'bg-green-50 text-green-700'
                        : message.proposalStatus === 'expired'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-sand text-ink/50',
                    )}>
                      {message.proposalStatus === 'confirmed' ? <Check size={14} /> : <X size={14} />}
                      {message.proposalStatus === 'confirmed'
                        ? 'Confirmed and completed'
                        : message.proposalStatus === 'expired'
                          ? 'Expired — ask for a new proposal'
                          : 'Cancelled — no changes made'}
                    </div>
                  )}
                </div>
              )}

              {message.planner && (
                <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-md sm:rounded-3xl sm:p-5" data-agent-gathering-planner={message.plannerStatus ?? 'ready'}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold tracking-wide text-blue-700">Editable gathering plan</p>
                      <h3 className="mt-1 font-serif text-base font-bold italic text-ink sm:text-lg">{message.planner.title}</h3>
                    </div>
                    <span className={cn(
                      'rounded-full px-3 py-1 text-[10px] font-bold tracking-wide',
                      message.plannerStatus === 'saved'
                        ? 'bg-green-50 text-green-700'
                        : message.plannerStatus === 'links_pending'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-blue-50 text-blue-700',
                    )}>
                      {message.plannerStatus === 'saved'
                        ? 'Saved'
                        : message.plannerStatus === 'links_pending'
                          ? 'Links pending'
                          : 'Not saved'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs leading-relaxed text-ink/65">
                    <p>{formatDubaiDateTime(message.plannerResult?.startAt ?? message.planner.startAt, 'short')}</p>
                    <p>{message.planner.locationName} · {message.planner.type}</p>
                    <p>
                      Invitees: {message.planner.memberIds.length
                        ? message.planner.memberIds.map(id => members.find(member => member.id === id)?.name ?? 'Unavailable member').join(', ')
                        : 'None selected'}
                    </p>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-ink/50">
                    Prepared by AI. Review every detail before saving. Nothing will be sent automatically.
                  </p>
                  {message.plannerStatus === 'links_pending' ? (
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900">
                      The gathering was saved, but its requested links were not prepared. Use Calendar to prepare them from the saved gathering.
                    </p>
                  ) : null}
                  {message.plannerStatus === 'saved' || message.plannerStatus === 'links_pending' ? (
                    onNavigateToActionResult ? (
                      <button
                        type="button"
                        onClick={() => viewPlannerMessageInCalendar(message)}
                        className="mt-4 flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-4 text-[11px] font-bold tracking-wide text-white hover:bg-gold-ink"
                      >
                        {message.plannerStatus === 'links_pending' ? 'Prepare links in Calendar' : 'View Calendar'} <ArrowRight size={12} />
                      </button>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      onClick={() => openPlanner(message.id)}
                      className="mt-4 flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-4 text-[11px] font-bold tracking-wide text-white hover:bg-gold-ink"
                    >
                      {message.plannerStatus === 'dismissed' ? 'Reopen editable planner' : 'Open editable planner'}
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {(isLoading || isRestoring) && (
          <div className="flex items-center gap-3 pl-12 text-gold-ink">
            <LoaderCircle className="animate-spin" size={17} />
            <span className="text-[11px] font-bold tracking-wide">
              {isRestoring ? 'Restoring private conversation' : 'Reading permitted family context'}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        className="assistant-composer-dock sticky bottom-0 z-20 shrink-0 border-t border-sepia/80 bg-sand/95 pb-1 pt-2 backdrop-blur"
        data-testid="assistant-composer-dock"
      >
        {messages.length < 4 && (
          <div className="assistant-mobile-optional assistant-quick-prompts mb-2 shrink-0">
            <p className="mb-1 px-0.5 text-[11px] font-bold tracking-wide text-ink/45">Try an example</p>
            <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 custom-scrollbar" data-testid="assistant-prompt-carousel">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="min-h-11 max-w-[82vw] shrink-0 snap-start truncate rounded-xl border border-sepia bg-white px-3 text-left text-[11px] font-semibold text-ink/60 transition-colors hover:border-gold-ink hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:max-w-sm"
                  title={prompt}
                >
                  <Sparkles className="mr-1.5 inline" size={12} /> {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className="assistant-required-composer"
          onFocusCapture={() => setComposerFocused(true)}
          onBlurCapture={event => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setComposerFocused(false);
            }
          }}
        >
        <div className="mb-2 rounded-xl border border-sepia bg-white px-2 py-1.5 text-xs text-ink/65" data-testid="gemini-consent-summary">
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={aiProcessingConsent}
                onChange={(event) => setAiProcessingConsent(event.target.checked)}
                disabled={!familyId || isLoading || isRestoring}
                className="size-5 shrink-0 accent-gold"
              />
              <span className="min-w-0">
                <strong className="block text-ink">Send this request to Google Gemini</strong>
                <span className="block text-[11px] text-ink/50">One-time approval for this message</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => setShowConsentDetails(current => !current)}
              className="min-h-11 shrink-0 rounded-lg px-2 text-[11px] font-bold text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
              aria-expanded={showConsentDetails}
              aria-controls="gemini-data-disclosure"
            >
              {showConsentDetails ? 'Hide details' : 'Read details'}
            </button>
          </div>
          {showConsentDetails ? (
            <p id="gemini-data-disclosure" className="max-h-32 overflow-y-auto overscroll-contain border-t border-sepia/60 px-1 pb-2 pt-2 text-[11px] leading-relaxed text-ink/60 sm:max-h-40">{agentDataDisclosureText}</p>
          ) : null}
        </div>
        <div className="relative shrink-0">
          <label htmlFor="family-agent-input" className="sr-only">Ask the family agent</label>
          <input
            id="family-agent-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            disabled={!familyId || isLoading || isRestoring}
            placeholder="Ask AI Helper…"
            enterKeyHint="send"
            className="min-h-12 w-full rounded-2xl border border-sepia bg-white px-4 py-3 pr-14 text-base text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-ink disabled:bg-sand disabled:text-ink/35 sm:text-sm"
          />
          <button
            type="button"
            aria-label="Send request"
            onClick={() => sendMessage()}
            disabled={!familyId || !input.trim() || !aiProcessingConsent || isLoading || isRestoring}
            className="absolute right-1.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl bg-ink text-white shadow-lg transition-all hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:opacity-30"
          >
            <Send size={18} />
          </button>
        </div>
        </div>
      </div>

      {activePlannerMessage?.planner && familyId ? (
        <BodyPortal>
          <div
            ref={plannerDialogRef}
            tabIndex={-1}
            className="mobile-sheet-overlay fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-0 backdrop-blur-sm sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="AI gathering planner"
            data-testid="ai-gathering-planner-sheet"
          >
            <section className="mobile-sheet-surface flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden border-0 border-sepia bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-[2rem] sm:border">
            <header className="mobile-sheet-header sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-sepia bg-sand/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:py-5">
              <div>
                <p className="text-[11px] font-bold tracking-wide text-gold-ink">AI Helper</p>
                <h3 className="font-serif text-lg font-bold italic text-ink sm:text-xl">
                  {activePlannerStage === 'details'
                    ? 'Plan Gathering'
                    : activePlannerStage === 'review'
                      ? 'Review before saving'
                      : activePlannerStage === 'links'
                        ? 'Invitation links'
                        : 'Gathering saved'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeActivePlanner}
                disabled={plannerBusy}
                className="flex size-11 items-center justify-center rounded-full hover:bg-sepia/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:opacity-40"
                aria-label="Close gathering planner"
              >
                <X size={20} />
              </button>
            </header>
            <GatheringPlanner
              familyId={familyId}
              members={members}
              prefill={activePlannerMessage.planner}
              source="ai"
              idempotencyKey={activePlannerMessage.id}
              onCancel={closeActivePlanner}
              onGatheringChanged={() => {
                if (sessionId && isCurrentConversationContext(familyId, sessionId)) {
                  void handlePlannerGatheringChanged(familyId, sessionId);
                }
              }}
              onSubmissionResult={result => {
                if (sessionId && isCurrentConversationContext(familyId, sessionId)) {
                  handlePlannerSubmissionResult(activePlannerMessage.id, result);
                }
              }}
              onViewCalendar={onNavigateToActionResult ? gathering => {
                if (sessionId && isCurrentOpenPlannerContext(familyId, sessionId, activePlannerMessage.id)) {
                  viewPlannerResultInCalendar(gathering);
                }
              } : undefined}
              onStageChange={stage => {
                if (sessionId && isCurrentOpenPlannerContext(familyId, sessionId, activePlannerMessage.id)) {
                  handlePlannerStageChange(stage);
                }
              }}
              onBusyChange={busy => {
                if (sessionId && isCurrentOpenPlannerContext(familyId, sessionId, activePlannerMessage.id)) {
                  setPlannerBusy(busy);
                }
              }}
            />
            </section>
          </div>
        </BodyPortal>
      ) : null}
    </div>
  );
}
