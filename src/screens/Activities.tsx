import { useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  AlertCircle,
  Clock,
  Filter,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ApiError, apiRequest } from '../api/client';
import type { ActivityListing } from '../engagementTypes';
import type { FamilyMember } from '../types';

interface ActivitiesProps {
  members: FamilyMember[];
  onPlanActivity: (activity: ActivityListing) => void;
}

export function Activities({ members, onPlanActivity }: ActivitiesProps) {
  const [activities, setActivities] = useState<ActivityListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [emirate, setEmirate] = useState('All');
  const [category, setCategory] = useState('All');
  const [price, setPrice] = useState('All');
  const [elderFriendly, setElderFriendly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    apiRequest<{ activities: ActivityListing[] }>('/api/activities')
      .then(result => {
        if (current) setActivities(result.activities);
      })
      .catch(caught => {
        if (current) setError(caught instanceof ApiError ? caught.message : 'The activity catalog could not load.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reloadKey]);

  const emirates = useMemo(() => ['All', ...new Set(activities.map(item => item.emirate))], [activities]);
  const categories = useMemo(() => ['All', ...new Set(activities.map(item => item.category))], [activities]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activities.filter(activity => (
      (!query || [activity.title, activity.description, activity.location, activity.category]
        .some(value => value.toLowerCase().includes(query)))
      && (emirate === 'All' || activity.emirate === emirate)
      && (category === 'All' || activity.category === category)
      && (price === 'All' || activity.priceRange === price)
      && (!elderFriendly || activity.elderlyFriendly)
    ));
  }, [activities, category, elderFriendly, emirate, price, search]);

  return (
    <div className="space-y-7">
      <section className="rounded-[2rem] border border-sepia bg-ink p-7 text-white shadow-lg">
        <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-gold"><ShieldCheck size={14} /> Curated catalog with provenance</p>
        <h3 className="mt-3 font-serif text-2xl italic">Choose a starting point for family time.</h3>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/55">
          Every prototype row is labelled. The app does not claim live availability, pricing, accessibility, ratings, or a partner relationship.
        </p>
      </section>

      <section className="space-y-4 rounded-[2rem] border border-sepia bg-white p-5 shadow-sm">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 text-ink/30" size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the catalog" className="w-full rounded-xl border border-sepia bg-sand/25 py-3 pl-11 pr-4 text-sm outline-none focus:border-gold" />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-[9px] font-bold uppercase tracking-wider text-ink/45">Emirate<select value={emirate} onChange={event => setEmirate(event.target.value)} className="mt-1 block w-full rounded-xl border border-sepia bg-white px-3 py-2.5 text-xs normal-case text-ink">{emirates.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-ink/45">Category<select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 block w-full rounded-xl border border-sepia bg-white px-3 py-2.5 text-xs normal-case text-ink">{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-ink/45">Budget<select value={price} onChange={event => setPrice(event.target.value)} className="mt-1 block w-full rounded-xl border border-sepia bg-white px-3 py-2.5 text-xs normal-case text-ink">{['All', 'Free', 'Budget', 'Premium'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 self-end rounded-xl border border-sepia px-3 py-2.5 text-xs text-ink/60"><input type="checkbox" checked={elderFriendly} onChange={event => setElderFriendly(event.target.checked)} className="accent-gold" /> Elder-friendly note</label>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={15} /> {error} No activity data was substituted.</span>
          <button type="button" onClick={() => setReloadKey(value => value + 1)} className="flex shrink-0 items-center gap-1 font-bold uppercase tracking-wider"><RefreshCw size={13} /> Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 rounded-[2rem] border border-sepia bg-white text-sm text-ink/45"><LoaderCircle className="animate-spin text-gold" size={20} /> Loading catalog…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-sepia bg-white/60 p-10 text-center">
          <Filter className="mx-auto text-gold" size={25} />
          <p className="mt-3 font-serif italic text-ink/50">No catalog rows match these filters.</p>
        </div>
      ) : (
        <section className="grid gap-5">
          {filtered.map(activity => (
            <article key={activity.id} className="overflow-hidden rounded-[2rem] border border-sepia bg-white shadow-sm">
              <div className="grid sm:grid-cols-[12rem_1fr]">
                {activity.image ? (
                  <img src={activity.image} alt="" className="h-48 w-full object-cover sm:h-full" />
                ) : (
                  <div className="flex min-h-40 items-center justify-center bg-gradient-to-br from-ink to-gold/80 text-white/70"><MapPin size={40} strokeWidth={1.2} /></div>
                )}
                <div className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gold">{activity.category} · {activity.isSample ? 'Prototype sample' : 'Verified listing'}</p>
                      <h3 className="mt-1 font-serif text-xl font-bold italic text-ink">{activity.title}</h3>
                    </div>
                    <span className="rounded-full bg-sand px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-ink/50">{activity.priceRange}</span>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink/60">{activity.description}</p>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[9px] font-bold uppercase tracking-wider text-ink/45">
                    <span className="flex items-center gap-1.5"><MapPin size={12} className="text-gold" /> {activity.location}, {activity.emirate}</span>
                    <span className="flex items-center gap-1.5"><Clock size={12} className="text-gold" /> {activity.estimatedDuration}</span>
                    {activity.elderlyFriendly && <span className="flex items-center gap-1.5"><Accessibility size={12} className="text-gold" /> Sample suitability flag</span>}
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sepia/60 pt-4">
                    <div>
                      <p className="text-[9px] text-ink/40">{activity.sourceLabel}</p>
                      {activity.verifiedAt && <p className="mt-1 text-[8px] text-ink/30">Verified {new Date(activity.verifiedAt).toLocaleDateString()}</p>}
                    </div>
                    <button type="button" onClick={() => onPlanActivity(activity)} className="flex items-center gap-2 rounded-xl bg-ink px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold"><Sparkles size={13} /> Ask agent to plan</button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <p className="text-center text-[9px] leading-relaxed text-ink/35">
        {members.length} family member{members.length === 1 ? '' : 's'} in the current Bond Map. Tell the agent your budget, timing, accessibility needs, and invitee preferences when requesting a reconnection plan.
      </p>
    </div>
  );
}
