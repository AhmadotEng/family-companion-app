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

  it.each([
    ['/invite/relative-token', 'https://family.example/invite/relative-token'],
    ['invite/path-token', 'https://family.example/invite/path-token'],
    ['//links.family.example/invite/protocol-relative', 'https://links.family.example/invite/protocol-relative'],
    ['http://links.family.example/invite/http-token', 'http://links.family.example/invite/http-token'],
    ['https://links.family.example/invite/https-token', 'https://links.family.example/invite/https-token'],
  ])('accepts the http(s)-resolving invitation URL %s', (candidate, expected) => {
    expect(absoluteInvitationUrl({
      memberId: 'member-1',
      memberName: 'Khaled',
      sharePath: candidate,
    }, 'https://family.example')).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'blob:https://family.example/private-token',
    'ftp://family.example/private-token',
    'http://[',
  ])('rejects the unsafe or malformed invitation URL %s', candidate => {
    expect(absoluteInvitationUrl({
      memberId: 'member-1',
      memberName: 'Khaled',
      sharePath: candidate,
    }, 'https://family.example')).toBe('');
  });

  it('fails closed when a preferred shareUrl is unsafe or the origin is malformed', () => {
    expect(absoluteInvitationUrl({
      memberId: 'member-1',
      memberName: 'Khaled',
      sharePath: '/invite/safe-fallback',
      shareUrl: 'javascript:alert(1)',
    }, 'https://family.example')).toBe('');
    expect(absoluteInvitationUrl({
      memberId: 'member-1',
      memberName: 'Khaled',
      sharePath: '/invite/relative-token',
    }, 'not a valid origin')).toBe('');
  });
});
