import { describe, expect, it } from 'vitest';
import {
  agentDataDisclosureText,
  buildDestructiveAgentConfirmation,
  canRoleConfirmAgentAction,
  formatAgentDetail,
  getAgentActionResources,
  getAgentConfirmButtonLabel,
  getAgentQuickPrompts,
  getAgentResultDestination,
  getAgentRoleNotice,
  invitationLinksUnavailableMessage,
  isDestructiveAgentAction,
  isFamilyGraphAction,
} from './agentPresentation';

describe('agent presentation helpers', () => {
  it('requires an extra confirmation for destructive and link-rotation actions', () => {
    expect(isDestructiveAgentAction('DELETE_MEMBER')).toBe(true);
    expect(isDestructiveAgentAction('DELETE_RELATIONSHIP')).toBe(true);
    expect(isDestructiveAgentAction('DELETE_MEMORY')).toBe(true);
    expect(isDestructiveAgentAction('COMPLETE_GATHERING')).toBe(true);
    expect(isDestructiveAgentAction('PREPARE_INVITATION_LINKS')).toBe(true);
    expect(isDestructiveAgentAction('ADD_MEMBER')).toBe(false);
    expect(isDestructiveAgentAction('CREATE_RECONNECTION_PLAN')).toBe(false);
  });

  it('identifies all supported family graph writes', () => {
    expect(isFamilyGraphAction('ADD_MEMBER')).toBe(true);
    expect(isFamilyGraphAction('UPDATE_MEMBER')).toBe(true);
    expect(isFamilyGraphAction('DELETE_MEMBER')).toBe(true);
    expect(isFamilyGraphAction('CREATE_RELATIONSHIP')).toBe(true);
    expect(isFamilyGraphAction('DELETE_RELATIONSHIP')).toBe(true);
    expect(isFamilyGraphAction('CREATE_RECONNECTION_PLAN')).toBe(false);
  });

  it('includes the exact proposal title, action, and details in destructive confirmation copy', () => {
    const copy = buildDestructiveAgentConfirmation({
      actionType: 'DELETE_MEMBER',
      title: 'Remove Khaled from the family',
      summary: "Permanently delete Khaled's unlinked family profile.",
      details: { member: 'Khaled', connectedRelationshipsRemoved: 2 },
    });

    expect(copy).toContain('Remove Khaled from the family');
    expect(copy).toContain('Action: DELETE MEMBER');
    expect(copy).toContain('Member: Khaled');
    expect(copy).toContain('Connected Relationships Removed: 2');
    expect(copy).toContain('cannot be undone');
  });

  it('explains invitation rotation and completion consequences in the second confirmation', () => {
    const invitationCopy = buildDestructiveAgentConfirmation({
      actionType: 'PREPARE_INVITATION_LINKS',
      title: 'Prepare links for Friday dinner',
      summary: 'Prepare private RSVP links for Khaled and Maryam.',
      details: { invitees: ['Khaled', 'Maryam'], channel: 'whatsapp' },
    });
    expect(invitationCopy).toContain('existing links for the selected people will stop working');
    expect(invitationCopy).toContain('Nothing is sent automatically');

    const completionCopy = buildDestructiveAgentConfirmation({
      actionType: 'COMPLETE_GATHERING',
      title: 'Complete Friday dinner',
      summary: 'Use two Going RSVPs as verified attendees.',
      details: { attendees: ['Khaled', 'Maryam'] },
    });
    expect(completionCopy).toContain('may award verified family points');
    expect(completionCopy).toContain('cannot be reversed');
  });

  it('renders nested proposal details in readable text', () => {
    expect(formatAgentDetail([{ existingMember: 'Ahmad', type: 'sibling' }])).toBe(
      'Existing Member: Ahmad | Type: sibling',
    );
  });

  it('shows role-appropriate examples without disabling members', () => {
    expect(getAgentQuickPrompts('admin').some((prompt) => prompt.includes('Remove Khaled'))).toBe(true);
    expect(getAgentQuickPrompts('member')).toContain('Update my birth date to 1985-04-12.');
    expect(getAgentRoleNotice('member')).toContain('update your own linked profile');
    expect(getAgentRoleNotice('member')).toContain('gatherings you created');
    expect(getAgentRoleNotice('owner')).toBeUndefined();
    expect(getAgentQuickPrompts('member').some((prompt) => prompt.toLowerCase().includes('delete'))).toBe(false);
    expect(getAgentRoleNotice('member')).toContain('AI-consented labels');
  });

  it('accurately distinguishes typed conversation data from database-derived private fields', () => {
    expect(agentDataDisclosureText).toContain('up to 20 recent messages');
    expect(agentDataDisclosureText).toContain('phone number, email, profile note, memory text');
    expect(agentDataDisclosureText).toContain('family name, current server date/time and Dubai timezone');
    expect(agentDataDisclosureText).toContain('Database-derived context excludes contact details');
    expect(agentDataDisclosureText).toContain('invitation tokens or URLs');
  });

  it('does not imply that one-time invitation links can be recovered by retrying confirmation', () => {
    expect(invitationLinksUnavailableMessage(true)).toContain('not returned again');
    expect(invitationLinksUnavailableMessage(true)).toContain('intend to rotate');
    expect(invitationLinksUnavailableMessage(false)).toContain('Do not confirm the same proposal again');
  });

  it('mirrors the server role boundary for action approval', () => {
    expect(canRoleConfirmAgentAction('COMPLETE_GATHERING', 'member')).toBe(false);
    expect(canRoleConfirmAgentAction('ADD_MEMBER', 'member')).toBe(false);
    expect(canRoleConfirmAgentAction('UPDATE_MEMBER', 'member')).toBe(true);
    expect(canRoleConfirmAgentAction('PREPARE_INVITATION_LINKS', 'member')).toBe(true);
    expect(canRoleConfirmAgentAction('DELETE_MEMORY', 'member')).toBe(true);
    expect(canRoleConfirmAgentAction('COMPLETE_GATHERING', 'admin')).toBe(true);
  });

  it('maps completed actions to the screens and resources that must refresh', () => {
    expect(getAgentActionResources('COMPLETE_GATHERING')).toEqual(['gatherings', 'rewards']);
    expect(getAgentActionResources('CREATE_NOTE_MEMORY')).toEqual(['memories', 'rewards']);
    expect(getAgentActionResources('UPDATE_PLAN_STATUS')).toEqual(['plans']);
    expect(getAgentResultDestination('ADD_MEMBER')).toBe('tree');
    expect(getAgentResultDestination('UPDATE_PLAN_STATUS')).toBe('assistant');
    expect(getAgentResultDestination('PREPARE_INVITATION_LINKS')).toBe('calendar');
    expect(getAgentResultDestination('DELETE_MEMORY')).toBe('archive');
    expect(getAgentConfirmButtonLabel('PREPARE_INVITATION_LINKS')).toBe('Review & prepare links');
  });
});
