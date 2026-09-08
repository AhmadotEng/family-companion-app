import { useEffect, useState } from 'react';
import { CalendarDays, Check, Clock, HelpCircle, LoaderCircle, MapPin, ShieldCheck, Users, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { engagementApi } from '../api/engagement';
import type { PublicInvitation, RsvpStatus } from '../engagementTypes';
import { formatDubaiDateTime } from '../lib/gatheringDate';
import { cn } from '../lib/utils';

interface PublicInvitationProps {
  token: string;
}

const options: Array<{
  status: Exclude<RsvpStatus, 'pending'>;
  label: string;
  icon: typeof Check;
  className: string;
}> = [
  { status: 'going', label: 'Going', icon: Check, className: 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100' },
  { status: 'maybe', label: 'Maybe', icon: HelpCircle, className: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { status: 'declined', label: 'Cannot go', icon: X, className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
];

export function PublicInvitationScreen({ token }: PublicInvitationProps) {
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [responding, setResponding] = useState<RsvpStatus | ''>('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    if (!token) {
      setError('This invitation link is incomplete or invalid.');
      setLoading(false);
      return () => { current = false; };
    }
    engagementApi.getPublicInvitation(token)
      .then(result => {
        if (current) setInvitation(result.invitation);
      })
      .catch(caught => {
        if (!current) return;
        setError(caught instanceof ApiError ? caught.message : 'This invitation could not be opened.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [token]);

  const respond = async (status: Exclude<RsvpStatus, 'pending'>) => {
    setResponding(status);
    setError('');
    setConfirmation('');
    try {
      const result = await engagementApi.respondToInvitation(token, status);
      setInvitation(previous => previous ? { ...previous, status: result.status } : previous);
      setConfirmation(result.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Your RSVP could not be saved. Please try again.');
    } finally {
      setResponding('');
    }
  };

  return (
    <main className="standalone-page public-invitation-screen min-h-screen bg-sand px-4 py-10 text-ink sm:py-16">
      <div className="mx-auto w-full min-w-0 max-w-xl">
        <header className="mb-5 text-center sm:mb-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-gold shadow-lg"><CalendarDays size={24} /></span>
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-gold">AILAH</p>
        </header>

        {loading ? (
          <section className="rounded-3xl border border-sepia bg-white p-6 text-center shadow-xl sm:rounded-[2rem] sm:p-12" aria-live="polite" aria-busy="true">
            <LoaderCircle className="mx-auto animate-spin text-gold" size={28} />
            <p className="mt-4 font-serif text-lg">Opening your invitation…</p>
          </section>
        ) : !invitation ? (
          <section className="rounded-3xl border border-sepia bg-white p-5 text-center shadow-xl sm:rounded-[2rem] sm:p-10">
            <X className="mx-auto text-red-500" size={30} />
            <h1 className="mt-4 font-serif text-2xl font-bold">Invitation unavailable</h1>
            <p role="alert" className="mt-3 text-sm leading-relaxed text-ink/60">{error || 'This invitation is invalid or is no longer available.'}</p>
            <p className="mt-5 text-sm text-ink/45">Ask the gathering organizer to prepare a new private link.</p>
          </section>
        ) : (
          <section className="min-w-0 overflow-hidden rounded-3xl border border-sepia bg-white shadow-xl sm:rounded-[2rem]">
            <div className="min-w-0 bg-ink p-5 text-white sm:p-7">
              <p className="break-words text-sm font-semibold text-gold">{invitation.familyName} invitation</p>
              <h1 className="mt-3 break-words font-serif text-[1.75rem] font-bold sm:text-3xl">{invitation.title}</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{invitation.purpose}</p>
            </div>
            <div className="min-w-0 space-y-5 p-5 sm:space-y-6 sm:p-7">
              <p className="break-words font-serif text-lg">Hello {invitation.inviteeName}, <span className="not-italic text-sm text-ink/55">{invitation.hostName} invited you.</span></p>
              <div className="min-w-0 space-y-3 rounded-2xl border border-sepia bg-sand/20 p-4 text-sm sm:p-5">
                <p className="flex min-w-0 items-start gap-3"><Clock className="mt-0.5 shrink-0 text-gold" size={17} /><span className="min-w-0"><strong className="block font-semibold">Date and time</strong><span className="break-words text-ink/60">{formatDubaiDateTime(invitation.startAt)}</span></span></p>
                <p className="flex min-w-0 items-start gap-3"><MapPin className="mt-0.5 shrink-0 text-gold" size={17} /><span className="min-w-0"><strong className="block font-semibold">Location</strong><span className="break-words text-ink/60">{invitation.locationName}</span></span></p>
                <p className="flex min-w-0 items-start gap-3"><Users className="mt-0.5 shrink-0 text-gold" size={17} /><span className="min-w-0"><strong className="block font-semibold">Gathering type</strong><span className="break-words text-ink/60">{invitation.type}</span></span></p>
              </div>
              {invitation.notes ? <p className="break-words border-l-2 border-gold pl-4 text-sm leading-relaxed text-ink/60">{invitation.notes}</p> : null}

              <div>
                <h2 className="text-sm font-semibold text-ink/50">Your RSVP</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {options.map(option => {
                    const Icon = option.icon;
                    const selected = invitation.status === option.status;
                    return (
                      <button key={option.status} type="button" disabled={Boolean(responding)} onClick={() => void respond(option.status)} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50', option.className, selected && 'ring-2 ring-ink ring-offset-2')} aria-pressed={selected}>
                        {responding === option.status ? <LoaderCircle className="animate-spin" size={14} /> : <Icon size={14} />} {option.label}
                      </button>
                    );
                  })}
                </div>
                {invitation.status !== 'pending' ? <p className="mt-3 text-center text-sm text-ink/50">Current response: <strong>{options.find(option => option.status === invitation.status)?.label}</strong>. You can change it above.</p> : null}
              </div>

              {confirmation ? <p role="status" className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"><Check className="shrink-0" size={15} /> {confirmation}</p> : null}
              {error ? <p role="alert" className="break-words rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
              <p className="flex items-start gap-2 border-t border-sepia pt-5 text-xs leading-relaxed text-ink/45"><ShieldCheck className="mt-0.5 shrink-0 text-gold" size={14} /> This private link records only the RSVP choice shown above. Do not forward it: anyone with the link can change this response.</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
