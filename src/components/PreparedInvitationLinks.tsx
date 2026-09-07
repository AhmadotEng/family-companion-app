import { useState } from 'react';
import { Check, Copy, ExternalLink, Info, MessageCircle, X } from 'lucide-react';
import type { EphemeralInvitationLinks } from '../lib/agentInvitationLinks';
import { absoluteInvitationUrl, whatsappInvitationUrl } from '../lib/agentInvitationLinks';

export function PreparedInvitationLinks({
  prepared,
  onDismiss,
  onContinue,
}: {
  prepared: EphemeralInvitationLinks;
  onDismiss: () => void;
  onContinue?: () => void;
}) {
  const [copiedMemberId, setCopiedMemberId] = useState('');
  const [copyError, setCopyError] = useState('');

  const copyLink = async (memberId: string, invitationUrl: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopiedMemberId(memberId);
      window.setTimeout(() => setCopiedMemberId(''), 1_800);
    } catch {
      setCopyError('The browser blocked clipboard access. Preview the link and copy it from the address bar.');
    }
  };

  return (
    <section className="mb-3 min-w-0 shrink-0 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-blue-950 sm:mb-4 sm:p-4" aria-labelledby="prepared-agent-links-title">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="prepared-agent-links-title" className="flex items-center gap-2 text-sm font-bold"><Info className="shrink-0" size={15} aria-hidden="true" /> Links prepared, not sent</p>
          <p className="mt-1 text-xs leading-relaxed">{prepared.deliveryNotice}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-blue-800">
            Copy these private links before leaving the Assistant. They are visible only in this live result and are not saved in the conversation or browser storage.
          </p>
          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? (
            <p className="mt-1 text-[11px] font-semibold text-blue-800">Localhost links normally work only on this computer.</p>
          ) : null}
        </div>
        <button type="button" onClick={onDismiss} className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-blue-200 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label="Hide prepared invitation links"><X size={17} aria-hidden="true" /></button>
      </header>
      <div className="mt-3 space-y-2">
        {prepared.invitations.map(invitation => {
          const invitationUrl = absoluteInvitationUrl(invitation, window.location.origin);
          if (!invitationUrl) return null;
          return (
            <article key={invitation.memberId} className="min-w-0 rounded-xl border border-blue-200 bg-white p-3">
              <p className="text-xs font-bold text-ink">{invitation.memberName}</p>
              <p className="mt-1 break-all text-[11px] leading-relaxed text-ink/45">{invitationUrl}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button type="button" onClick={() => void copyLink(invitation.memberId, invitationUrl)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2">
                  {copiedMemberId === invitation.memberId ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copiedMemberId === invitation.memberId ? 'Copied' : 'Copy link'}
                </button>
                <a href={invitationUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-sepia px-3 text-xs font-semibold text-ink hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">
                  <ExternalLink size={14} aria-hidden="true" /> Preview
                </a>
                <button type="button" onClick={() => window.open(whatsappInvitationUrl(invitationUrl), '_blank', 'noopener,noreferrer')} className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 text-xs font-semibold text-green-800 hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 sm:col-auto">
                  <MessageCircle size={14} aria-hidden="true" /> Open WhatsApp
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {copyError ? <p role="alert" className="mt-2 text-xs text-red-700">{copyError}</p> : null}
      {onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          className="mt-3 min-h-11 w-full rounded-xl border border-blue-300 bg-white px-4 text-xs font-semibold text-blue-900 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:w-auto"
        >
          I copied the links — view Calendar
        </button>
      ) : null}
    </section>
  );
}
