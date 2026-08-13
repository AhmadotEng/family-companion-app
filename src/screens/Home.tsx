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
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-bold italic text-ink">Marhaba</h2>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-ink/55">Your private family workspace</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-gold/20 bg-gold/10 px-4 py-2 text-gold">
          <ShieldCheck size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Account protected</span>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-[2rem] border border-sepia bg-white p-8 shadow-sm">
        <div className="relative z-10 max-w-xl">
          <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-gold">
            <Sparkles size={14} /> Controlled family agent
          </p>
          <h3 className="mt-4 font-serif text-2xl italic leading-tight text-ink">
            Describe a family change or ask for a gentle reconnection plan in everyday language.
          </h3>
          <p className="mt-3 text-xs leading-relaxed text-ink/55">
            The agent reads only permitted context and shows an exact proposal. Nothing is saved until you confirm it.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigateToAssistant('Create a gentle reconnection plan for my family. Ask me for any preferences or missing information you need.')}
              className="rounded-full bg-ink px-6 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white hover:bg-gold"
            >
              Plan with the agent
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className="rounded-full border border-sepia px-6 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-ink hover:border-gold"
            >
              Open Bond Map
            </button>
          </div>
        </div>
        <Network className="absolute -bottom-10 -right-8 text-gold/10" size={190} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <button type="button" onClick={() => setActiveTab('tree')} className="rounded-3xl border border-sepia bg-white p-6 text-left shadow-sm hover:border-gold">
          <div className="flex items-center gap-2 text-ink/45"><Users size={15} className="text-gold" /><span className="text-[9px] font-bold uppercase tracking-widest">Persisted Bond Map</span></div>
          <p className="mt-3 font-serif text-3xl font-bold italic text-ink">{members.length}</p>
          <p className="mt-1 text-xs text-ink/45">family member{members.length === 1 ? '' : 's'} recorded</p>
        </button>
        <button type="button" onClick={() => setActiveTab('calendar')} className="rounded-3xl border border-sepia bg-white p-6 text-left shadow-sm hover:border-gold">
          <div className="flex items-center gap-2 text-ink/45"><CalendarDays size={15} className="text-gold" /><span className="text-[9px] font-bold uppercase tracking-widest">Upcoming Gatherings</span></div>
          <p className="mt-3 font-serif text-3xl font-bold italic text-ink">{upcomingGatherings.length}</p>
          <p className="mt-1 text-xs text-ink/45">persisted upcoming item{upcomingGatherings.length === 1 ? '' : 's'}</p>
        </button>
      </section>

      <section>
        <div className="mb-5 flex items-baseline justify-between border-b border-sepia pb-3">
          <h3 className="font-serif text-xl italic text-ink">Family Members</h3>
          <button type="button" onClick={() => setActiveTab('tree')} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-gold hover:underline">
            Manage <ArrowRight size={11} />
          </button>
        </div>
        {members.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sepia bg-white/60 p-8 text-center">
            <p className="font-serif italic text-ink/50">No family members are visible yet.</p>
          </div>
        ) : (
          <div className="flex gap-5 overflow-x-auto pb-3">
            {members.map(member => (
              <button type="button" key={member.id} onClick={() => setSelectedMember(member)} className="min-w-28 rounded-2xl border border-sepia bg-white p-4 text-center shadow-sm hover:border-gold">
                <img src={member.photo} alt="" className="mx-auto size-16 rounded-full border border-sepia object-cover" />
                <span className="mt-3 block truncate text-xs font-bold text-ink">{member.name}</span>
                <span className="mt-1 block text-[8px] font-bold uppercase tracking-wider text-ink/35">{member.relationship}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-5 flex items-baseline justify-between border-b border-sepia pb-3">
          <h3 className="font-serif text-xl italic text-ink">Upcoming Gatherings</h3>
          <button type="button" onClick={() => setActiveTab('calendar')} className="text-[9px] font-bold uppercase tracking-widest text-gold hover:underline">Open Calendar</button>
        </div>
        {upcomingGatherings.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sepia bg-white/60 p-8 text-center">
            <p className="font-serif italic text-ink/50">No upcoming gathering has been saved.</p>
            <button type="button" onClick={() => setActiveTab('calendar')} className="mt-3 text-[9px] font-bold uppercase tracking-widest text-gold">Plan a gathering</button>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingGatherings.map(gathering => {
              const going = Object.values(gathering.rsvpStatus).filter(status => status === 'Going').length;
              return (
                <button type="button" key={gathering.id} onClick={() => setActiveTab('calendar')} className="w-full rounded-3xl border border-sepia bg-white p-5 text-left shadow-sm hover:border-gold">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gold">{gathering.type}</p>
                      <h4 className="mt-1 font-serif text-lg font-bold text-ink">{gathering.title}</h4>
                    </div>
                    <span className="rounded-full bg-sand px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-ink/50">{going} going</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-sepia/60 pt-4 text-[10px] font-bold uppercase tracking-wider text-ink/45">
                    <span className="flex items-center gap-1.5"><CalendarDays size={12} className="text-gold" /> {parseGatheringDate(gathering.date).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><Clock size={12} className="text-gold" /> {gathering.time}</span>
                    <span className="flex items-center gap-1.5"><MapPin size={12} className="text-gold" /> {gathering.location}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <AnimatePresence>
        {selectedMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${selectedMember.name} profile`}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full max-w-md overflow-hidden rounded-[2rem] border border-sepia bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-sepia bg-sand p-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-gold">Persisted family profile</p>
                <button type="button" onClick={() => setSelectedMember(null)} aria-label="Close"><X size={19} /></button>
              </div>
              <div className="space-y-5 p-7">
                <div className="flex items-center gap-4">
                  <img src={selectedMember.photo} alt="" className="size-20 rounded-full border border-sepia object-cover" />
                  <div>
                    <h3 className="font-serif text-2xl font-bold italic">{selectedMember.name}</h3>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-ink/40">{selectedMember.relationship}</p>
                  </div>
                </div>
                <dl className="divide-y divide-sepia overflow-hidden rounded-2xl border border-sepia text-xs">
                  {selectedMember.birthday && <div className="grid grid-cols-[7rem_1fr] gap-3 p-3"><dt className="font-bold text-ink/40">Birthday</dt><dd>{selectedMember.birthday}</dd></div>}
                  <div className="grid grid-cols-[7rem_1fr] gap-3 p-3"><dt className="font-bold text-ink/40">Location</dt><dd>{locationSummary(selectedMember)}</dd></div>
                  {selectedMember.interests.length > 0 && <div className="grid grid-cols-[7rem_1fr] gap-3 p-3"><dt className="font-bold text-ink/40">Interests</dt><dd>{selectedMember.interests.join(', ')}</dd></div>}
                  {selectedMember.notes && <div className="grid grid-cols-[7rem_1fr] gap-3 p-3"><dt className="font-bold text-ink/40">Notes</dt><dd>{selectedMember.notes}</dd></div>}
                </dl>
                <p className="flex items-start gap-2 text-[10px] leading-relaxed text-ink/40"><ShieldCheck className="mt-0.5 shrink-0" size={13} /> Location is already filtered by consent and visibility. This screen never receives raw coordinates.</p>
              </div>
              <div className="flex gap-3 border-t border-sepia bg-sand p-5">
                <button type="button" onClick={() => { setSelectedMember(null); navigateToAssistant(`Help me plan a thoughtful activity with ${selectedMember.name}. Ask for any missing preferences before proposing a plan.`); }} className="flex-1 rounded-xl bg-ink px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold">Ask agent</button>
                <button type="button" onClick={() => { setSelectedMember(null); setActiveTab('tree'); }} className="flex-1 rounded-xl border border-sepia bg-white px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-ink/60">Manage in Bond Map</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
