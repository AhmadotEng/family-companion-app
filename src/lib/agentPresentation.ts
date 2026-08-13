import type { FamilyRole } from '../types';

export type AgentResource = 'family' | 'gatherings' | 'plans' | 'memories' | 'rewards';
export type AgentResultDestination = 'tree' | 'assistant' | 'calendar' | 'archive';

export interface AgentProposalPresentation {
  actionType: string;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
}

const DETAILED_CONFIRMATION_ACTION_TYPES = new Set([
  'DELETE_MEMBER',
  'DELETE_RELATIONSHIP',
  'DELETE_MEMORY',
  'COMPLETE_GATHERING',
  'PREPARE_INVITATION_LINKS',
]);
const FAMILY_GRAPH_ACTION_TYPES = new Set([
  'ADD_MEMBER',
  'UPDATE_MEMBER',
  'DELETE_MEMBER',
  'CREATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
]);

const ADMIN_ONLY_ACTION_TYPES = new Set([
  'ADD_MEMBER',
  'DELETE_MEMBER',
  'CREATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
  'COMPLETE_GATHERING',
]);

const ACTION_RESOURCES: Record<string, AgentResource[]> = {
  ADD_MEMBER: ['family'],
  UPDATE_MEMBER: ['family'],
  DELETE_MEMBER: ['family'],
  CREATE_RELATIONSHIP: ['family'],
  DELETE_RELATIONSHIP: ['family'],
  CREATE_RECONNECTION_PLAN: ['plans'],
  UPDATE_PLAN_STATUS: ['plans'],
  CREATE_GATHERING_DRAFT: ['gatherings'],
  PREPARE_INVITATION_LINKS: ['gatherings'],
  COMPLETE_GATHERING: ['gatherings', 'rewards'],
  CREATE_NOTE_MEMORY: ['memories', 'rewards'],
  DELETE_MEMORY: ['memories'],
};

const ACTION_DESTINATIONS: Record<string, AgentResultDestination> = {
  ADD_MEMBER: 'tree',
  UPDATE_MEMBER: 'tree',
  DELETE_MEMBER: 'tree',
  CREATE_RELATIONSHIP: 'tree',
  DELETE_RELATIONSHIP: 'tree',
  CREATE_RECONNECTION_PLAN: 'assistant',
  UPDATE_PLAN_STATUS: 'assistant',
  CREATE_GATHERING_DRAFT: 'calendar',
  PREPARE_INVITATION_LINKS: 'calendar',
  COMPLETE_GATHERING: 'calendar',
  CREATE_NOTE_MEMORY: 'archive',
  DELETE_MEMORY: 'archive',
};

export const agentWelcomeText =
  'Marhaba. Ask in plain language. I can help with the Bond Map, gathering drafts and invitation links, verified gathering completion, written memories, rewards-related updates, and reconnection-plan status. What I can change depends on your family role and ownership of the item. For privacy, I can identify an existing memory only when that memory was allowed for AI processing; every memory remains manageable directly in the Archive. I always show the exact action for approval before anything changes, and I never send invitations automatically.';

export const agentDataDisclosureText =
  'Gemini receives this request and up to 20 recent messages from this agent conversation. Any phone number, email, profile note, memory text, or other private information you typed in those messages is therefore sent again with this request. Gemini also receives the family name, current server date/time and Dubai timezone, family member IDs and display names, relationships, consent-visible city/emirate or coarse distance bands, authorized gathering and invitation-status metadata, AI-consented memory labels, plan-status metadata, engagement counts, reward totals, and sample activities. Database-derived context excludes contact details, profile notes, memory contents and media, exact coordinates, and invitation tokens or URLs. Prompts and replies are retained privately on this server for up to 30 days unless you delete the conversation sooner. This approval applies only to the next request.';

const adminQuickPrompts = [
  'Add my brother Khaled, born 1985-04-12.',
  'Create a gathering draft for a family dinner tomorrow at 7 PM.',
  'Prepare WhatsApp invitation links for my next gathering.',
  'Complete the past gathering using its Going RSVPs.',
  'Save a private written memory for my completed gathering.',
  'Mark my latest reconnection plan as accepted.',
  'Remove Khaled from the family tree.',
];

const memberQuickPrompts = [
  'Update my birth date to 1985-04-12.',
  'Create a gathering draft for a family dinner tomorrow at 7 PM.',
  'Prepare invitation links for a gathering I created.',
  'Save a private written memory for my completed gathering.',
  'Mark my latest reconnection plan as accepted.',
  'Create a gentle reconnection plan for me and a relative.',
];

export function getAgentQuickPrompts(role: FamilyRole): string[] {
  return role === 'owner' || role === 'admin' ? adminQuickPrompts : memberQuickPrompts;
}

export function getAgentRoleNotice(role: FamilyRole): string | undefined {
  if (role !== 'member') return undefined;
  return 'As a family member, you can update your own linked profile; create gathering drafts; manage links for gatherings you created; create written memories; manage plans you created; and delete your own memories when their AI-consented labels are available to the agent. Use the Archive to manage every memory directly. Only an owner or administrator can manage the wider family graph or complete gatherings and award verified points.';
}

export function invitationLinksUnavailableMessage(alreadyCompleted: boolean): string {
  return alreadyCompleted
    ? 'This invitation-link action had already completed, so its private links were not returned again. Check the links you copied from the original result. Ask for a new proposal only if you intend to rotate those links again.'
    : 'The invitation-link action completed, but this response did not contain usable private links. Do not confirm the same proposal again. Ask for a new proposal only if you intend to rotate those links again.';
}

export function isDestructiveAgentAction(actionType: string): boolean {
  return DETAILED_CONFIRMATION_ACTION_TYPES.has(actionType);
}

export function isFamilyGraphAction(actionType: string): boolean {
  return FAMILY_GRAPH_ACTION_TYPES.has(actionType);
}

export function canRoleConfirmAgentAction(actionType: string, role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || !ADMIN_ONLY_ACTION_TYPES.has(actionType);
}

export function getAgentActionResources(actionType: string): AgentResource[] {
  return [...(ACTION_RESOURCES[actionType] ?? [])];
}

export function getAgentResultDestination(actionType: string): AgentResultDestination | undefined {
  return ACTION_DESTINATIONS[actionType];
}

export function getAgentResultDestinationLabel(actionType: string): string | undefined {
  const destination = getAgentResultDestination(actionType);
  if (destination === 'tree') return 'View Bond Map';
  if (destination === 'assistant') return 'View Reconnection Plans';
  if (destination === 'calendar') return 'View Calendar';
  if (destination === 'archive') return 'View Memories & Rewards';
  return undefined;
}

export function getAgentConfirmButtonLabel(actionType: string): string {
  if (actionType === 'PREPARE_INVITATION_LINKS') return 'Review & prepare links';
  if (actionType === 'COMPLETE_GATHERING') return 'Review & complete';
  if (actionType === 'DELETE_MEMORY' || actionType.startsWith('DELETE_')) return 'Review & delete';
  return 'Confirm change';
}

export function humanizeAgentLabel(label: string): string {
  return label
    .replaceAll('_', ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

export function formatAgentDetail(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (Array.isArray(value)) return value.map(formatAgentDetail).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([label, nestedValue]) => `${humanizeAgentLabel(label)}: ${formatAgentDetail(nestedValue)}`)
      .join(' | ');
  }
  return String(value);
}

export function buildDestructiveAgentConfirmation(proposal: AgentProposalPresentation): string {
  const detailLines = Object.entries(proposal.details ?? {}).map(
    ([label, value]) => `- ${humanizeAgentLabel(label)}: ${formatAgentDetail(value)}`,
  );

  const actionSpecificWarning = proposal.actionType === 'PREPARE_INVITATION_LINKS'
    ? 'This creates new private RSVP tokens. Any existing links for the selected people will stop working. Nothing is sent automatically.'
    : proposal.actionType === 'COMPLETE_GATHERING'
      ? 'This marks the gathering completed and may award verified family points. Completion cannot be reversed in the app.'
      : proposal.actionType === 'DELETE_MEMORY'
        ? 'This permanently deletes the memory record and any stored private media. It cannot be recovered from the app.'
        : 'This action cannot be undone from the app.';

  const heading = proposal.actionType === 'PREPARE_INVITATION_LINKS'
    ? 'Confirm private-link preparation'
    : proposal.actionType === 'COMPLETE_GATHERING'
      ? 'Confirm gathering completion'
      : 'Confirm permanent action';

  return [
    heading,
    '',
    proposal.title,
    `Action: ${humanizeAgentLabel(proposal.actionType)}`,
    proposal.summary,
    ...(detailLines.length ? ['', 'Details:', ...detailLines] : []),
    '',
    actionSpecificWarning,
    'Do you want to continue?',
  ].join('\n');
}
