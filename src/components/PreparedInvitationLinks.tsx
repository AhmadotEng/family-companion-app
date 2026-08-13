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
    <section className="mb-4 shrink-0 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950" aria-labelledby="prepared-agent-links-title">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p id="prepared-agent-links-title" className="flex items-center gap-2 text-xs font-bold"><Info size={14} /> Links prepared, not sent</p>
          <p className="mt-1 text-[11px] leading-relaxed">{prepared.deliveryNotice}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-blue-800">
            Copy these private links before leaving the Assistant. They are visible only in this live result and are not saved in the conversation or browser storage.
          </p>
          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? (
            <p className="mt-1 text-[10px] font-semibold text-blue-800">Localhost links normally work only on this computer.</p>
          ) : null}
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 rounded-lg border border-blue-200 p-1.5 hover:bg-blue-100" aria-label="Hide prepared invitation links"><X size={14} /></button>
      </header>
      <div className="mt-3 space-y-2">
        {prepared.invitations.map((invitation) => {
          const invitationUrl = absoluteInvitationUrl(invitation, window.location.origin);
          if (!invitationUrl) return null;
          return (
            <article key={invitation.memberId} className="rounded-xl border border-blue-200 bg-white p-3">
              <p className="text-xs font-bold text-ink">{invitation.memberName}</p>
              <p className="mt-1 truncate text-[10px] text-ink/45">{invitationUrl}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyLink(invitation.memberId, invitationUrl)} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white hover:bg-gold">
                  {copiedMemberId === invitation.memberId ? <Check size={12} /> : <Copy size={12} />}
                  {copiedMemberId === invitation.memberId ? 'Copied' : 'Copy link'}
                </button>
                <a href={invitationUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-sepia px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-ink hover:border-gold">
                  <ExternalLink size={12} /> Preview
                </a>
                <button type="button" onClick={() => window.open(whatsappInvitationUrl(invitationUrl), '_blank', 'noopener,noreferrer')} className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-green-800 hover:bg-green-100">
                  <MessageCircle size={12} /> Open WhatsApp
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
          className="mt-3 rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider text-blue-900 hover:bg-blue-100"
        >
          I copied the links — view Calendar
        </button>
      ) : null}
    </section>
  );
}
