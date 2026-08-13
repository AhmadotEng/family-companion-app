export function invitationTokenFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const token = decodeURIComponent(match[1]);
    return token.length >= 32 && token.length <= 200 ? token : null;
  } catch {
    return null;
  }
}

/** Keeps malformed invitation URLs on the public error screen instead of
 * accidentally sending recipients to the account sign-in flow. */
export function isInvitationPath(pathname: string): boolean {
  return /^\/invite(?:\/|$)/.test(pathname);
}
