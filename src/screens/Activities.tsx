import { useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  AlertCircle,
  CalendarPlus,
  ChevronDown,
  Clock,
  Filter,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../api/client';
import type { ActivityListing } from '../engagementTypes';
import { cn } from '../lib/utils';
import type { FamilyMember } from '../types';

interface ActivitiesProps {
  members: FamilyMember[];
  onPlanActivity: (activity: ActivityListing) => void;
  onPlanManually?: (activity: ActivityListing) => void;
}

export function Activities({ members, onPlanActivity, onPlanManually }: ActivitiesProps) {
  const [activities, setActivities] = useState<ActivityListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [emirate, setEmirate] = useState('All');
  const [category, setCategory] = useState('All');
  const [price, setPrice] = useState('All');
  const [elderFriendly, setElderFriendly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const activeFilterCount = [emirate !== 'All', category !== 'All', price !== 'All', elderFriendly].filter(Boolean).length;
  const clearFilters = () => {
    setEmirate('All');
    setCategory('All');
    setPrice('All');
    setElderFriendly(false);
  };

  return (
    <div className="space-y-4 sm:space-y-7">
      <section className="flex min-h-[8rem] flex-col justify-center rounded-3xl border border-sepia bg-ink p-5 text-white shadow-lg sm:min-h-0 sm:rounded-[2rem] sm:p-8">
        <p className="flex items-center gap-2 text-xs font-semibold text-gold"><ShieldCheck size={15} aria-hidden="true" /> Curated for family time</p>
        <h3 className="mt-2 font-serif text-xl leading-tight sm:mt-3 sm:text-2xl">Find a place everyone will enjoy.</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
          Choose an activity everyone can enjoy, then plan it with SILAH or build the gathering yourself.
        </p>
      </section>

      <section className="space-y-3" aria-label="Search and filter activities">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search activities</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/35" size={18} aria-hidden="true" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search activities"
              className="min-h-12 w-full rounded-xl border border-sepia bg-white py-2.5 pl-11 pr-4 text-base text-ink shadow-sm outline-none transition-colors placeholder:text-ink/35 focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="activity-filters"
            onClick={() => setFiltersOpen(open => !open)}
            className="relative flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border border-sepia bg-white px-3 text-sm font-semibold text-ink/65 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:hidden"
          >
            <Filter size={17} aria-hidden="true" /> Filters
            {activeFilterCount > 0 && <span aria-label={`${activeFilterCount} active filters`} className="flex size-5 items-center justify-center rounded-full bg-gold-ink text-[10px] text-white">{activeFilterCount}</span>}
            <ChevronDown className={cn('transition-transform', filtersOpen && 'rotate-180')} size={15} aria-hidden="true" />
          </button>
        </div>

        {activeFilterCount > 0 && (
          <div className="scrollbar-hide flex items-center gap-2 overflow-x-auto overscroll-x-contain pb-1" aria-label="Active filters">
            {emirate !== 'All' && <button type="button" onClick={() => setEmirate('All')} aria-label={`Remove emirate filter ${emirate}`} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-3 text-xs font-semibold text-ink"><span>{emirate}</span><X size={14} aria-hidden="true" /></button>}
            {category !== 'All' && <button type="button" onClick={() => setCategory('All')} aria-label={`Remove category filter ${category}`} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-3 text-xs font-semibold text-ink"><span>{category}</span><X size={14} aria-hidden="true" /></button>}
            {price !== 'All' && <button type="button" onClick={() => setPrice('All')} aria-label={`Remove budget filter ${price}`} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-3 text-xs font-semibold text-ink"><span>{price}</span><X size={14} aria-hidden="true" /></button>}
            {elderFriendly && <button type="button" onClick={() => setElderFriendly(false)} aria-label="Remove elder-friendly filter" className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-3 text-xs font-semibold text-ink"><span>Elder-friendly</span><X size={14} aria-hidden="true" /></button>}
            <button type="button" onClick={clearFilters} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-gold-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink">Clear all</button>
          </div>
        )}

        <div
          id="activity-filters"
          className={cn(
            'rounded-2xl border border-sepia bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-5',
            filtersOpen ? 'grid gap-3' : 'hidden',
            'sm:grid sm:grid-cols-4 sm:gap-3',
          )}
        >
          <label className="text-xs font-semibold text-ink/55">Emirate<select value={emirate} onChange={event => setEmirate(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-sepia bg-white px-3 py-2 text-base font-normal text-ink sm:text-xs">{emirates.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink/55">Category<select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-sepia bg-white px-3 py-2 text-base font-normal text-ink sm:text-xs">{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink/55">Price range<select value={price} onChange={event => setPrice(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-sepia bg-white px-3 py-2 text-base font-normal text-ink sm:text-xs">{['All', 'Free', 'Budget', 'Premium'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-sepia px-3 py-2 text-sm text-ink/65"><input type="checkbox" checked={elderFriendly} onChange={event => setElderFriendly(event.target.checked)} className="size-4 accent-gold" /> Elder-friendly</label>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={15} aria-hidden="true" /> {error} No activity data was substituted.</span>
          <button type="button" onClick={() => setReloadKey(value => value + 1)} className="flex min-h-11 shrink-0 items-center gap-1 px-2 font-semibold"><RefreshCw size={13} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-sepia bg-white text-sm text-ink/65 sm:min-h-52 sm:rounded-[2rem]"><LoaderCircle className="animate-spin text-gold" size={20} aria-hidden="true" /> Loading catalog…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sepia bg-white/60 p-6 text-center sm:rounded-[2rem] sm:p-10">
          <Filter className="mx-auto text-gold" size={25} aria-hidden="true" />
          <p className="mt-3 font-serif text-ink/65">No activities match these filters.</p>
        </div>
      ) : (
        <section aria-labelledby="activity-results-heading">
          <div className="mb-2 flex min-h-11 items-center justify-between sm:mb-3">
            <h3 id="activity-results-heading" className="font-serif text-lg text-ink sm:text-xl">Activities</h3>
            <p role="status" className="text-xs text-ink/65">{`${filtered.length} result${filtered.length === 1 ? '' : 's'}`}</p>
          </div>
          <div className="grid gap-3 sm:gap-5">
            {filtered.map(activity => (
              <article key={activity.id} className="overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm sm:rounded-[2rem]">
                <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[12rem_1fr]">
                  {activity.image ? (
                    <img src={activity.image} alt="" className="h-full min-h-48 w-full object-cover sm:min-h-0" />
                  ) : (
                    <div className="flex min-h-48 items-center justify-center bg-gradient-to-br from-ink to-gold/80 text-white/70 sm:min-h-40"><MapPin size={36} strokeWidth={1.2} aria-hidden="true" /></div>
                  )}
                  <div className="min-w-0 p-3.5 sm:p-6">
                    <div className="flex items-start justify-between gap-2 sm:gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-gold-ink">{activity.category}</p>
                        <h3 className="mt-0.5 font-serif text-base font-bold leading-tight text-ink sm:mt-1 sm:text-xl">{activity.title}</h3>
                      </div>
                      <span className="hidden shrink-0 rounded-full bg-sand px-3 py-1 text-xs font-semibold text-ink/70 sm:inline">{activity.priceRange}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink/75 sm:mt-3">{activity.description}</p>
                    <div className="mt-3 grid gap-1.5 text-xs text-ink/70 sm:mt-4 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
                      <span className="flex min-w-0 items-center gap-1.5"><MapPin size={12} className="shrink-0 text-gold" aria-hidden="true" /><span className="truncate">{activity.location}, {activity.emirate}</span></span>
                      <span className="flex items-center gap-1.5"><Clock size={12} className="shrink-0 text-gold" aria-hidden="true" /> {activity.estimatedDuration}</span>
                      {activity.elderlyFriendly && <span className="hidden items-center gap-1.5 sm:flex"><Accessibility size={12} className="text-gold" aria-hidden="true" /> Elder-friendly note</span>}
                    </div>
                    <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-sepia/60 pt-2.5 sm:mt-5 sm:items-center sm:gap-3 sm:pt-4">
                      <span className="hidden sm:block" />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => onPlanManually?.(activity)} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-sepia bg-white px-3 text-xs font-semibold text-ink transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:px-4"><CalendarPlus size={14} aria-hidden="true" /> Plan manually</button>
                        <button type="button" onClick={() => onPlanActivity(activity)} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3 text-xs font-semibold text-white transition-colors hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 sm:px-4"><Sparkles size={14} aria-hidden="true" /> Plan with SILAH</button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="pb-2 text-center text-[10px] leading-relaxed text-ink/40">
        {`${members.length} family member${members.length === 1 ? '' : 's'} available to invite from your Family Tree.`}
      </p>
    </div>
  );
}
