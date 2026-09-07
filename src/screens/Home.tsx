import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useModalFocusTrap } from '../lib/modalFocus';
import type { FamilyMember, Gathering } from '../types';

interface HomeProps {
  members: FamilyMember[];
  gatherings: Gathering[];
  setActiveTab: (tab: string) => void;
  navigateToAssistant: (presetText: string) => void;
}

const parseGatheringDate = (value: string) => new Date(value.includes('T') ? value : `${value}T00:00:00`);

function locationSummary(member: FamilyMember): string {
  const location = member.safeLocation;
  if (!location) return 'No location shared';
  return [location.city, location.emirate, location.distanceBand].filter(Boolean).join(' · ') || 'Location shared';
}

export function Home({ members, gatherings, setActiveTab, navigateToAssistant }: HomeProps) {
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const memberDialogRef = useModalFocusTrap<HTMLDivElement>({
    active: Boolean(selectedMember),
    onEscape: () => setSelectedMember(null),
  });
  const upcomingGatherings = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return gatherings
      .filter(gathering => {
        const date = parseGatheringDate(gathering.date);
        return !Number.isNaN(date.getTime()) && date >= startOfToday;
      })
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
      .slice(0, 3);
  }, [gatherings]);

  return (
    <div className="space-y-4 sm:space-y-8">
      <section className="flex items-center justify-between gap-3" aria-label="Welcome">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-lg font-bold italic text-ink sm:text-3xl">Marhaba</h3>
          <p className="mt-0.5 truncate text-xs text-ink/55 sm:mt-1">Your private family workspace</p>
        </div>
        <div className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-gold/20 bg-gold/10 px-3 text-gold-ink sm:rounded-2xl sm:px-4">
          <ShieldCheck size={15} aria-hidden="true" />
          <span className="text-[10px] font-semibold">Account protected</span>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl border border-sepia bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-8">
        <div className="relative z-10 max-w-xl">
          <p className="flex items-center gap-2 text-[10px] font-semibold text-gold-ink sm:text-xs">
            <Sparkles size={14} aria-hidden="true" /> AI family planning
          </p>
          <h3 className="mt-2 font-serif text-lg font-bold italic leading-tight text-ink sm:mt-4 sm:text-2xl">
            Plan family time with a helping hand.
          </h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink/55 sm:mt-3">
            Ask in everyday language. You review every change before it is saved.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-6 sm:gap-3">
            <button
              type="button"
              onClick={() => navigateToAssistant('')}
              className="flex min-h-11 items-center rounded-full bg-ink px-5 text-xs font-semibold text-white transition-colors hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 sm:px-6"
            >
              Open AI Helper
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-gold-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
            >
              <Network size={15} aria-hidden="true" /> Open Bond Map
            </button>
          </div>
        </div>
        <Network className="absolute -bottom-5 -right-4 size-24 text-gold/10 sm:-bottom-10 sm:-right-8 sm:size-48" aria-hidden="true" />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4" aria-label="Family summary">
        <button
          type="button"
          onClick={() => setActiveTab('tree')}
          className="min-h-24 rounded-2xl border border-sepia bg-white p-3.5 text-left shadow-sm transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:min-h-0 sm:rounded-3xl sm:p-6"
        >
          <div className="flex items-center gap-1.5 text-ink/50">
            <Users size={15} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="truncate text-[10px] font-semibold">Family members</span>
          </div>
          <p className="mt-1.5 font-serif text-2xl font-bold italic text-ink sm:mt-3 sm:text-3xl">{members.length}</p>
          <p className="text-[11px] text-ink/45">recorded</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className="min-h-24 rounded-2xl border border-sepia bg-white p-3.5 text-left shadow-sm transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:min-h-0 sm:rounded-3xl sm:p-6"
        >
          <div className="flex items-center gap-1.5 text-ink/50">
            <CalendarDays size={15} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="truncate text-[10px] font-semibold">Upcoming</span>
          </div>
          <p className="mt-1.5 font-serif text-2xl font-bold italic text-ink sm:mt-3 sm:text-3xl">{upcomingGatherings.length}</p>
          <p className="text-[11px] text-ink/45">gathering{upcomingGatherings.length === 1 ? '' : 's'}</p>
        </button>
      </section>

      <section aria-labelledby="family-members-heading">
        <div className="mb-3 flex min-h-11 items-center justify-between border-b border-sepia sm:mb-5 sm:items-baseline sm:pb-3">
          <h3 id="family-members-heading" className="font-serif text-lg italic text-ink sm:text-xl">Family members</h3>
          <button type="button" onClick={() => setActiveTab('tree')} className="flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-gold-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">
            Manage <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sepia bg-white/60 p-5 text-center sm:rounded-3xl sm:p-8">
            <p className="font-serif italic text-ink/50">No family members are visible yet.</p>
          </div>
        ) : (
          <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 sm:gap-5 sm:pb-3">
            {members.map(member => (
              <button
                type="button"
                key={member.id}
                onClick={() => setSelectedMember(member)}
                className="min-w-[7.25rem] snap-start rounded-2xl border border-sepia bg-white p-3 text-center shadow-sm transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:min-w-28 sm:p-4"
              >
                <img src={member.photo} alt="" className="mx-auto size-12 rounded-full border border-sepia object-cover sm:size-16" />
                <span className="mt-2 block truncate text-xs font-bold text-ink sm:mt-3">{member.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-ink/40 sm:mt-1">{member.relationship}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="upcoming-gatherings-heading">
        <div className="mb-3 flex min-h-11 items-center justify-between border-b border-sepia sm:mb-5 sm:items-baseline sm:pb-3">
          <h3 id="upcoming-gatherings-heading" className="font-serif text-lg italic text-ink sm:text-xl">Upcoming gatherings</h3>
          <button type="button" onClick={() => setActiveTab('calendar')} className="min-h-11 px-1 text-xs font-semibold text-gold-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Open calendar</button>
        </div>
        {upcomingGatherings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sepia bg-white/60 p-5 text-center sm:rounded-3xl sm:p-8">
            <p className="font-serif italic text-ink/50">No upcoming gathering has been saved.</p>
            <button type="button" onClick={() => setActiveTab('calendar')} className="mt-1 min-h-11 text-xs font-semibold text-gold-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Plan a gathering</button>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingGatherings.map(gathering => {
              const going = Object.values(gathering.rsvpStatus).filter(status => status === 'Going').length;
              return (
                <button
                  type="button"
                  key={gathering.id}
                  onClick={() => setActiveTab('calendar')}
                  className="w-full rounded-2xl border border-sepia bg-white p-4 text-left shadow-sm transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:rounded-3xl sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold text-gold-ink">{gathering.type}</p>
                      <h4 className="mt-0.5 truncate font-serif text-base font-bold text-ink sm:mt-1 sm:text-lg">{gathering.title}</h4>
                    </div>
                    <span className="shrink-0 rounded-full bg-sand px-2.5 py-1 text-[10px] font-semibold text-ink/50">{going} going</span>
                  </div>
                  <div className="mt-3 grid gap-1.5 border-t border-sepia/60 pt-3 text-[11px] text-ink/50 sm:mt-4 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-2 sm:pt-4">
                    <span className="flex items-center gap-1.5"><CalendarDays size={13} className="shrink-0 text-gold" aria-hidden="true" /> {parseGatheringDate(gathering.date).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><Clock size={13} className="shrink-0 text-gold" aria-hidden="true" /> {gathering.time}</span>
                    <span className="flex min-w-0 items-center gap-1.5"><MapPin size={13} className="shrink-0 text-gold" aria-hidden="true" /><span className="truncate">{gathering.location}</span></span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <AnimatePresence>
        {selectedMember && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-ink/45 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
            role="presentation"
            onMouseDown={event => {
              if (event.target === event.currentTarget) setSelectedMember(null);
            }}
          >
            <motion.div
              ref={memberDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedMember.name} profile`}
              tabIndex={-1}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full overflow-y-auto rounded-t-3xl border border-sepia bg-white shadow-2xl sm:max-w-md sm:rounded-[2rem]"
            >
              <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-sepia bg-sand px-4 sm:p-5">
                <p className="text-xs font-semibold text-gold-ink">Family profile</p>
                <button type="button" onClick={() => setSelectedMember(null)} aria-label="Close profile" className="flex size-11 items-center justify-center rounded-full hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"><X size={19} aria-hidden="true" /></button>
              </div>
              <div className="space-y-4 p-4 sm:space-y-5 sm:p-7">
                <div className="flex items-center gap-4">
                  <img src={selectedMember.photo} alt="" className="size-16 rounded-full border border-sepia object-cover sm:size-20" />
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-xl font-bold italic sm:text-2xl">{selectedMember.name}</h3>
                    <p className="mt-1 text-xs text-ink/45">{selectedMember.relationship}</p>
                  </div>
                </div>
                <dl className="divide-y divide-sepia overflow-hidden rounded-2xl border border-sepia text-xs">
                  {selectedMember.birthday && <div className="grid grid-cols-[6rem_1fr] gap-3 p-3 sm:grid-cols-[7rem_1fr]"><dt className="font-bold text-ink/40">Birthday</dt><dd>{selectedMember.birthday}</dd></div>}
                  <div className="grid grid-cols-[6rem_1fr] gap-3 p-3 sm:grid-cols-[7rem_1fr]"><dt className="font-bold text-ink/40">Location</dt><dd>{locationSummary(selectedMember)}</dd></div>
                  {selectedMember.interests.length > 0 && <div className="grid grid-cols-[6rem_1fr] gap-3 p-3 sm:grid-cols-[7rem_1fr]"><dt className="font-bold text-ink/40">Interests</dt><dd>{selectedMember.interests.join(', ')}</dd></div>}
                  {selectedMember.notes && <div className="grid grid-cols-[6rem_1fr] gap-3 p-3 sm:grid-cols-[7rem_1fr]"><dt className="font-bold text-ink/40">Notes</dt><dd>{selectedMember.notes}</dd></div>}
                </dl>
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink/45"><ShieldCheck className="mt-0.5 shrink-0" size={14} aria-hidden="true" /> Location is filtered by consent and visibility. Raw coordinates are never shown here.</p>
              </div>
              <div className="app-safe-area-footer sticky bottom-0 grid grid-cols-2 gap-2 border-t border-sepia bg-sand p-3 sm:gap-3 sm:p-5">
                <button type="button" onClick={() => { setSelectedMember(null); navigateToAssistant(`Help me plan a thoughtful activity with ${selectedMember.name}. Ask for any missing preferences before proposing a plan.`); }} className="min-h-11 rounded-xl bg-ink px-3 text-xs font-semibold text-white transition-colors hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Ask AI Helper</button>
                <button type="button" onClick={() => { setSelectedMember(null); setActiveTab('tree'); }} className="min-h-11 rounded-xl border border-sepia bg-white px-3 text-xs font-semibold text-ink/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Open Bond Map</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
