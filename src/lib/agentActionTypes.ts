export const AGENT_ACTION_TYPES = [
  'ADD_MEMBER',
  'UPDATE_MEMBER',
  'DELETE_MEMBER',
  'CREATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
  'CREATE_RECONNECTION_PLAN',
  'CREATE_GATHERING_DRAFT',
  'PREPARE_INVITATION_LINKS',
  'COMPLETE_GATHERING',
  'CREATE_NOTE_MEMORY',
  'DELETE_MEMORY',
  'UPDATE_PLAN_STATUS',
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

const agentActionTypeSet: ReadonlySet<string> = new Set(AGENT_ACTION_TYPES);

export function isKnownAgentActionType(value: unknown): value is AgentActionType {
  return typeof value === 'string' && agentActionTypeSet.has(value);
}
