import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_TYPES,
  buildDestructiveAgentConfirmation,
  canRoleConfirmAgentAction,
  getAgentActionResources,
  getAgentConfirmButtonLabel,
  getAgentResultDestination,
  getAgentResultDestinationLabel,
  isKnownAgentActionType,
  isDestructiveAgentAction,
  isFamilyGraphAction,
  type AgentResource,
  type AgentResultDestination,
} from './agentPresentation';

interface ActionPresentationCase {
  actionType: string;
  resources: AgentResource[];
  destination: AgentResultDestination;
  destinationLabel: string;
  destructive: boolean;
  familyGraph: boolean;
  memberCanConfirm: boolean;
  confirmLabel: string;
}

const actionCases: ActionPresentationCase[] = [
  ['ADD_MEMBER', ['family'], 'tree', 'View Family Tree', false, true, false, 'Confirm change'],
  ['UPDATE_MEMBER', ['family'], 'tree', 'View Family Tree', false, true, true, 'Confirm change'],
  ['DELETE_MEMBER', ['family'], 'tree', 'View Family Tree', true, true, false, 'Review & delete'],
  ['CREATE_RELATIONSHIP', ['family'], 'tree', 'View Family Tree', false, true, false, 'Confirm change'],
  ['DELETE_RELATIONSHIP', ['family'], 'tree', 'View Family Tree', true, true, false, 'Review & delete'],
  ['CREATE_RECONNECTION_PLAN', ['plans'], 'assistant', 'View Reconnection Plans', false, false, true, 'Confirm change'],
  ['UPDATE_PLAN_STATUS', ['plans'], 'assistant', 'View Reconnection Plans', false, false, true, 'Confirm change'],
  ['CREATE_GATHERING_DRAFT', ['gatherings'], 'calendar', 'View Calendar', false, false, true, 'Confirm change'],
  ['PREPARE_INVITATION_LINKS', ['gatherings'], 'calendar', 'View Calendar', true, false, true, 'Review & prepare links'],
  ['COMPLETE_GATHERING', ['gatherings', 'rewards'], 'calendar', 'View Calendar', true, false, false, 'Review & complete'],
  ['CREATE_NOTE_MEMORY', ['memories', 'rewards'], 'archive', 'View Memories & Rewards', false, false, true, 'Confirm change'],
  ['DELETE_MEMORY', ['memories'], 'archive', 'View Memories & Rewards', true, false, true, 'Review & delete'],
].map(([actionType, resources, destination, destinationLabel, destructive, familyGraph, memberCanConfirm, confirmLabel]) => ({
  actionType: actionType as string,
  resources: resources as AgentResource[],
  destination: destination as AgentResultDestination,
  destinationLabel: destinationLabel as string,
  destructive: destructive as boolean,
  familyGraph: familyGraph as boolean,
  memberCanConfirm: memberCanConfirm as boolean,
  confirmLabel: confirmLabel as string,
}));

describe('complete agent action presentation matrix', () => {
  it('keeps presentation metadata in lockstep with the shared action registry', () => {
    expect(actionCases.map(row => row.actionType).sort()).toEqual([...AGENT_ACTION_TYPES].sort());
  });

  it.each(actionCases)('$actionType has complete role, navigation, resource, and confirmation metadata', row => {
    expect(getAgentActionResources(row.actionType)).toEqual(row.resources);
    expect(getAgentResultDestination(row.actionType)).toBe(row.destination);
    expect(getAgentResultDestinationLabel(row.actionType)).toBe(row.destinationLabel);
    expect(isDestructiveAgentAction(row.actionType)).toBe(row.destructive);
    expect(isFamilyGraphAction(row.actionType)).toBe(row.familyGraph);
    expect(getAgentConfirmButtonLabel(row.actionType)).toBe(row.confirmLabel);
    expect(canRoleConfirmAgentAction(row.actionType, 'owner')).toBe(true);
    expect(canRoleConfirmAgentAction(row.actionType, 'admin')).toBe(true);
    expect(canRoleConfirmAgentAction(row.actionType, 'member')).toBe(row.memberCanConfirm);
  });

  it.each(actionCases.filter(row => row.destructive))('$actionType renders a complete second-confirmation warning', row => {
    const copy = buildDestructiveAgentConfirmation({
      actionType: row.actionType,
      title: `${row.actionType} title`,
      summary: `${row.actionType} summary`,
      details: { target: 'Example target', count: 2 },
    });

    expect(copy).toContain(`${row.actionType} title`);
    expect(copy).toContain(`${row.actionType} summary`);
    expect(copy).toContain('Target: Example target');
    expect(copy).toContain('Count: 2');
    expect(copy).toContain('Do you want to continue?');
  });

  it('fails closed for an unknown action type', () => {
    expect(isKnownAgentActionType('UNKNOWN_ACTION')).toBe(false);
    expect(getAgentActionResources('UNKNOWN_ACTION')).toEqual([]);
    expect(getAgentResultDestination('UNKNOWN_ACTION')).toBeUndefined();
    expect(getAgentResultDestinationLabel('UNKNOWN_ACTION')).toBeUndefined();
    expect(isDestructiveAgentAction('UNKNOWN_ACTION')).toBe(true);
    expect(isFamilyGraphAction('UNKNOWN_ACTION')).toBe(false);
    expect(canRoleConfirmAgentAction('UNKNOWN_ACTION', 'owner')).toBe(false);
    expect(canRoleConfirmAgentAction('UNKNOWN_ACTION', 'admin')).toBe(false);
    expect(canRoleConfirmAgentAction('UNKNOWN_ACTION', 'member')).toBe(false);
    expect(getAgentConfirmButtonLabel('UNKNOWN_ACTION')).toBe('Review unsupported action');
  });
});
