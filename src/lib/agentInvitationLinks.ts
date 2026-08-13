import type { PreparedInvitation } from '../engagementTypes';

export interface EphemeralInvitationLinks {
  gatheringId?: string;
  invitations: PreparedInvitation[];
  deliveryNotice: string;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function preparedInvitation(value: unknown): PreparedInvitation | undefined {
  const candidate = objectValue(value);
  if (!candidate) return undefined;
  const memberId = typeof candidate.memberId === 'string' ? candidate.memberId : '';
  const memberName = typeof candidate.memberName === 'string' ? candidate.memberName : '';
  const sharePath = typeof candidate.sharePath === 'string' ? candidate.sharePath : '';
  const shareUrl = typeof candidate.shareUrl === 'string' ? candidate.shareUrl : undefined;
  if (!memberId || !memberName || (!sharePath && !shareUrl)) return undefined;
  return {
    memberId,
    memberName,
    sharePath: sharePath || shareUrl!,
    ...(shareUrl ? { shareUrl } : {}),
    ...(typeof candidate.whatsappUrl === 'string' ? { whatsappUrl: candidate.whatsappUrl } : {}),
  };
}

/**
 * Invitation URLs are deliberately extracted only from the live confirmation
 * response. Callers must keep this bundle in transient component state rather
 * than adding it to conversation messages or browser storage.
 */
export function extractEphemeralInvitationLinks(
  actionType: string,
  result: unknown,
): EphemeralInvitationLinks | undefined {
  if (actionType !== 'PREPARE_INVITATION_LINKS') return undefined;
  const candidate = objectValue(result);
  if (!candidate || !Array.isArray(candidate.invitations)) return undefined;
  const invitations = candidate.invitations
    .map(preparedInvitation)
    .filter((invitation): invitation is PreparedInvitation => Boolean(invitation));
  if (invitations.length === 0) return undefined;
  return {
    ...(typeof candidate.gatheringId === 'string' ? { gatheringId: candidate.gatheringId } : {}),
    invitations,
    deliveryNotice: typeof candidate.deliveryNotice === 'string' && candidate.deliveryNotice.trim()
      ? candidate.deliveryNotice
      : 'Private RSVP links were prepared. No message was sent.',
  };
}

export function absoluteInvitationUrl(invitation: PreparedInvitation, origin: string): string {
  const candidate = invitation.shareUrl || invitation.sharePath;
  try {
    const url = new URL(candidate, origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function whatsappInvitationUrl(invitationUrl: string): string {
  const message = `Private family gathering invitation. Please RSVP: ${invitationUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
