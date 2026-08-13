import { describe, expect, it } from 'vitest';
import {
  absoluteInvitationUrl,
  extractEphemeralInvitationLinks,
  whatsappInvitationUrl,
} from './agentInvitationLinks';

describe('ephemeral agent invitation links', () => {
  it('extracts links only from a live invitation-preparation result', () => {
    const result = extractEphemeralInvitationLinks('PREPARE_INVITATION_LINKS', {
      gatheringId: 'gathering-1',
      deliveryNotice: 'Prepared only; nothing was sent.',
      invitations: [{
        memberId: 'member-1',
        memberName: 'Khaled',
        sharePath: '/invite/private-token',
        shareUrl: 'https://family.example/invite/private-token',
      }],
    });
    expect(result).toEqual({
      gatheringId: 'gathering-1',
      deliveryNotice: 'Prepared only; nothing was sent.',
      invitations: [{
        memberId: 'member-1',
        memberName: 'Khaled',
        sharePath: '/invite/private-token',
        shareUrl: 'https://family.example/invite/private-token',
      }],
    });
    expect(extractEphemeralInvitationLinks('CREATE_GATHERING_DRAFT', result)).toBeUndefined();
  });

  it('rejects malformed link entries and does not manufacture a token', () => {
    expect(extractEphemeralInvitationLinks('PREPARE_INVITATION_LINKS', {
      invitations: [{ memberId: 'member-1', memberName: 'Khaled' }],
    })).toBeUndefined();
  });

  it('creates safe absolute preview, copy, and WhatsApp URLs', () => {
    const invitation = { memberId: 'member-1', memberName: 'Khaled', sharePath: '/invite/private-token' };
    const absolute = absoluteInvitationUrl(invitation, 'http://127.0.0.1:4000');
    expect(absolute).toBe('http://127.0.0.1:4000/invite/private-token');
    expect(whatsappInvitationUrl(absolute)).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(whatsappInvitationUrl(absolute))).toContain(absolute);
    expect(absoluteInvitationUrl({ ...invitation, sharePath: 'javascript:alert(1)' }, 'https://family.example')).toBe('');
  });
});
