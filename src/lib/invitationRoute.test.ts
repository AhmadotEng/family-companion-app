import { describe, expect, it } from 'vitest';
import { invitationTokenFromPath, isInvitationPath } from './invitationRoute';

describe('invitationTokenFromPath', () => {
  const token = 'a'.repeat(43);

  it('recognizes only the public invitation route', () => {
    expect(invitationTokenFromPath(`/invite/${token}`)).toBe(token);
    expect(invitationTokenFromPath(`/invite/${token}/`)).toBe(token);
    expect(invitationTokenFromPath('/calendar')).toBeNull();
  });

  it('rejects short or nested tokens', () => {
    expect(invitationTokenFromPath('/invite/short')).toBeNull();
    expect(invitationTokenFromPath(`/invite/${token}/extra`)).toBeNull();
  });

  it('still recognizes malformed invitation routes as public', () => {
    expect(isInvitationPath('/invite/short')).toBe(true);
    expect(isInvitationPath('/invite/')).toBe(true);
    expect(isInvitationPath('/calendar')).toBe(false);
  });
});
