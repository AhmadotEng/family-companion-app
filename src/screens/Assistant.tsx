import { useEffect, useRef, useState } from 'react';
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
import type { GatheringPlanPrefill } from '../api/reconnectionPlans';
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
  type AgentResource,
} from '../lib/agentPresentation';
import {
  extractEphemeralInvitationLinks,
  type EphemeralInvitationLinks,
} from '../lib/agentInvitationLinks';
import type { FamilyMember, FamilyRole } from '../types';

export interface AgentActionCompletion {
  actionType: string;
  resources: AgentResource[];
}

interface AssistantProps {
  presetInput: string;
  clearPreset: () => void;
  familyId?: string;
  members: FamilyMember[];
  familyRole?: FamilyRole;
  isActive?: boolean;
  onActionCompleted?: (completion: AgentActionCompletion) => Promise<void> | void;
  onNavigateToActionResult?: (actionType: string) => void;
  onUseReconnectionPlan: (prefill: GatheringPlanPrefill) => void;
}

interface ActionProposal {
  id: string;
  actionType: string;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  warnings?: string[];
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposal?: ActionProposal;
  proposalStatus?: 'pending' | 'confirmed' | 'rejected';
  completedActionType?: string;
}

interface AgentResponse {
  sessionId: string;
  kind: 'message' | 'clarification' | 'proposal';
  message: string;
  proposal?: ActionProposal;
}

interface AgentProposalResolutionResponse {
  message?: string;
  result?: unknown;
  alreadyCompleted?: boolean;
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
  text: agentWelcomeText,
};

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
  const [activeProposalId, setActiveProposalId] = useState<string>();
  const [uncertainProposalIds, setUncertainProposalIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<AgentErrorNotice>();
  const [planRefreshVersion, setPlanRefreshVersion] = useState(0);
  const [aiProcessingConsent, setAiProcessingConsent] = useState(false);
  const [ephemeralInvitationLinks, setEphemeralInvitationLinks] = useState<EphemeralInvitationLinks>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const quickPrompts = getAgentQuickPrompts(familyRole);
  const roleNotice = getAgentRoleNotice(familyRole);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!presetInput) return;
    setInput(presetInput);
    clearPreset();
  }, [clearPreset, presetInput]);

  useEffect(() => {
    setEphemeralInvitationLinks(undefined);
  }, [familyId]);

  useEffect(() => {
    if (!isActive) setEphemeralInvitationLinks(undefined);
  }, [isActive]);

  const sendMessage = async (overrideInput?: string) => {
    const messageText = (overrideInput ?? input).trim();
    if (!messageText || isLoading || !familyId) return;
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
      const body = await apiRequest<AgentResponse>('/api/agent/messages', {
        method: 'POST',
        body: JSON.stringify({ familyId, sessionId, message: messageText, aiProcessingConsent: true }),
      });
      if (!body.sessionId || !body.kind || !body.message) {
        throw new Error('The family agent returned an invalid response.');
      }

      setSessionId(body.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: body.message,
          proposal: body.proposal,
          proposalStatus: body.proposal ? 'pending' : undefined,
        },
      ]);
    } catch (requestError) {
      setError({
        phase: 'request',
        outcome: 'unchanged',
        title: 'Agent request failed',
        message: requestErrorMessage(requestError, 'The family agent is currently unavailable.'),
        consequence: 'No family data was changed by this request.',
      });
    } finally {
      setIsLoading(false);
      setAiProcessingConsent(false);
    }
  };

  const resolveProposal = async (
    proposal: ActionProposal,
    decision: 'confirm' | 'reject',
    options: { statusCheck?: boolean } = {},
  ) => {
    const proposalId = proposal.id;
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
      const body = await apiRequest<AgentProposalResolutionResponse>(`/api/agent/action-proposals/${encodeURIComponent(proposalId)}/${decision}`, {
        method: 'POST',
      });

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
      const notice = proposalResolutionError(requestError, decision);
      setError(notice);
      if (decision === 'confirm' && notice.outcome === 'unknown') {
        setUncertainProposalIds((current) => new Set(current).add(proposalId));
      }
    } finally {
      setActiveProposalId(undefined);
    }
  };

  const deleteConversation = async () => {
    if (!sessionId || !window.confirm('Permanently delete this AI conversation and its pending proposals?')) return;
    setIsLoading(true);
    setError(undefined);
    try {
      await apiRequest<void>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      setSessionId(undefined);
      setMessages([welcomeMessage]);
      setUncertainProposalIds(new Set());
      setInput('');
      setAiProcessingConsent(false);
      setEphemeralInvitationLinks(undefined);
    } catch (requestError) {
      setError({
        phase: 'conversation',
        outcome: 'unknown',
        title: 'Conversation deletion could not be verified',
        message: requestErrorMessage(requestError, 'The conversation could not be deleted.'),
        consequence: 'Family records were not changed. The conversation may already have been deleted if the connection failed after the server acted.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[32rem] flex-col lg:h-[calc(100vh-12rem)]">
      <div className="mb-4 rounded-2xl border border-gold/20 bg-gold/10 p-4 text-ink">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-gold" size={18} />
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Confirm-before-write agent</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/65">
              The model may suggest actions, but validated server code performs them only after you approve the exact change.
            </p>
          </div>
          {sessionId && (
            <button
              type="button"
              onClick={() => void deleteConversation()}
              disabled={isLoading}
              className="shrink-0 rounded-xl border border-gold/30 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-ink/55 hover:border-red-300 hover:text-red-700 disabled:opacity-40"
            >
              Delete conversation
            </button>
          )}
        </div>
      </div>

      {!familyId && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700" role="alert">
          <AlertCircle size={18} />
          <p className="text-xs font-semibold">Sign in and select a family before using the agent.</p>
        </div>
      )}

      {familyId && roleNotice && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800" role="status">
          <AlertCircle size={18} />
          <p className="text-xs font-semibold">{roleNotice}</p>
        </div>
      )}

      {familyId ? (
        <ReconnectionPlansPanel
          familyId={familyId}
          members={members}
          refreshVersion={planRefreshVersion}
          onUsePlan={onUseReconnectionPlan}
        />
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
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700" role="alert" data-agent-error-phase={error.phase}>
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="text-xs font-bold">{error.title}</p>
            <p className="mt-1 text-xs leading-relaxed">{error.message}</p>
            <p className="mt-1 text-[10px] text-red-600/80">{error.consequence}</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex-1 space-y-5 overflow-y-auto pr-2 custom-scrollbar" aria-live="polite">
        {messages.map((message) => (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            key={message.id}
            className={cn('flex max-w-[95%] items-start gap-3 sm:max-w-[88%]', message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto')}
          >
            <div className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full border shadow-sm',
              message.role === 'user' ? 'border-ink bg-ink text-white' : 'border-sepia bg-white text-gold',
            )}>
              {message.role === 'user' ? <span className="text-[10px] font-bold">YOU</span> : <Bot size={17} />}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className={cn(
                'whitespace-pre-wrap rounded-3xl p-5 text-sm leading-relaxed shadow-sm',
                message.role === 'user'
                  ? 'rounded-tr-none bg-ink text-white'
                  : 'rounded-tl-none border border-sepia bg-white text-ink',
              )}>
                {message.text}
                {message.completedActionType && message.completedActionType !== 'PREPARE_INVITATION_LINKS' && getAgentResultDestinationLabel(message.completedActionType) && onNavigateToActionResult ? (
                  <button
                    type="button"
                    onClick={() => onNavigateToActionResult(message.completedActionType!)}
                    className="mt-3 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-gold hover:text-ink"
                  >
                    {getAgentResultDestinationLabel(message.completedActionType)} <ArrowRight size={12} />
                  </button>
                ) : null}
              </div>

              {message.proposal && (
                <div className="rounded-3xl border border-gold/35 bg-white p-5 shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold">Proposed action</p>
                      <h3 className="mt-1 font-serif text-lg font-bold italic text-ink">{message.proposal.title}</h3>
                    </div>
                    <span className="rounded-full bg-sand px-3 py-1 text-[8px] font-bold uppercase tracking-wider text-ink/50">
                      {humanizeAgentLabel(message.proposal.actionType)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink/65">{message.proposal.summary}</p>

                  {message.proposal.details && Object.keys(message.proposal.details).length > 0 && (
                    <dl className="mt-4 divide-y divide-sepia/40 overflow-hidden rounded-2xl border border-sepia/50">
                      {Object.entries(message.proposal.details).map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5 text-xs">
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
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                        >
                          {activeProposalId === message.proposal.id ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}
                          Check confirmation status
                        </button>
                      ) : canRoleConfirmAgentAction(message.proposal.actionType, familyRole) ? (
                        <button
                          type="button"
                          disabled={Boolean(activeProposalId)}
                          onClick={() => void resolveProposal(message.proposal!, 'confirm')}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-gold disabled:opacity-40"
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
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-sepia px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink/60 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                        >
                          <X size={15} /> Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className={cn(
                      'mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[10px] font-bold uppercase tracking-wider',
                      message.proposalStatus === 'confirmed' ? 'bg-green-50 text-green-700' : 'bg-sand text-ink/50',
                    )}>
                      {message.proposalStatus === 'confirmed' ? <Check size={14} /> : <X size={14} />}
                      {message.proposalStatus === 'confirmed' ? 'Confirmed and completed' : 'Cancelled — no changes made'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-3 pl-12 text-gold">
            <LoaderCircle className="animate-spin" size={17} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Reading permitted family context</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length < 4 && (
        <div className="mb-4 shrink-0">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.25em] text-ink/40">Try a request</p>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="rounded-xl border border-sepia bg-white px-3 py-2 text-left text-[10px] font-semibold text-ink/60 transition-colors hover:border-gold hover:text-gold"
              >
                <Sparkles className="mr-1.5 inline" size={12} /> {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-sepia bg-white p-4 text-xs text-ink/65">
        <input
          type="checkbox"
          checked={aiProcessingConsent}
          onChange={(event) => setAiProcessingConsent(event.target.checked)}
          disabled={!familyId || isLoading}
          className="mt-0.5 size-4 accent-gold"
        />
        <span>
          <strong className="block text-ink">Send this request to Google Gemini</strong>
          {agentDataDisclosureText}
        </span>
      </label>
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
          disabled={!familyId || isLoading}
          placeholder="For example: Add my aunt Maryam, my mother's sister..."
          className="w-full rounded-2xl border border-sepia bg-white px-5 py-4 pr-14 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-sand disabled:text-ink/35"
        />
        <button
          type="button"
          aria-label="Send request"
          onClick={() => sendMessage()}
          disabled={!familyId || !input.trim() || !aiProcessingConsent || isLoading}
          className="absolute right-2 top-2 rounded-xl bg-ink p-3 text-white shadow-lg transition-all hover:bg-gold disabled:opacity-30"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
