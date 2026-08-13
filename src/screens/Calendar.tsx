import React, { useState } from 'react';
import { Gathering, CalendarEvent, FamilyMember } from '../types';
import { Calendar as CalendarIcon, Clock, MapPin, Plus, ChevronLeft, ChevronRight, Bell, Users, X, Info, Check, AlertCircle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface CalendarProps {
  gatherings: Gathering[];
  setGatherings: React.Dispatch<React.SetStateAction<Gathering[]>>;
  events: CalendarEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>;
  members: FamilyMember[];
}

export function Calendar({ gatherings, setGatherings, events, setEvents, members }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date('2026-05-01'));
  const [selectedDate, setSelectedDate] = useState(new Date('2026-05-18'));
  const [plannerOpen, setPlannerOpen] = useState(false);

  // Form states for new gathering
  const [formTitle, setFormTitle] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formDate, setFormDate] = useState('2026-05-20');
  const [formTime, setFormTime] = useState('14:00');
  const [formType, setFormType] = useState('Majlis');
  const [formLocationPreset, setFormLocationPreset] = useState('Grandfather\'s Majlis, Abu Dhabi');
  const [formLocationCustom, setFormLocationCustom] = useState('');
  const [invitedIds, setInvitedIds] = useState<string[]>(members.map(m => m.id));
  const [formNotes, setFormNotes] = useState('');

  // Keep invitedIds in sync with members list changes (filters out removed members, adds new ones by default)
  React.useEffect(() => {
    setInvitedIds(prev => {
      const currentValid = prev.filter(id => members.some(m => m.id === id));
      const newIds = members.filter(m => !prev.includes(m.id)).map(m => m.id);
      return [...currentValid, ...newIds];
    });
  }, [members]);

  const startDate = startOfMonth(currentMonth);
  const endDate = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const allEvents = [
    ...events.map(e => ({ ...e, eventType: 'Event' as const })),
    ...gatherings.map(g => ({ ...g, type: 'Gathering' as const, eventType: 'Gathering' as const }))
  ];

  const selectedDateEvents = allEvents.filter(e => isSameDay(new Date(e.date), selectedDate));

  const locationPresets = [
    "Grandfather's Majlis, Abu Dhabi",
    "Arabian Tea House, Dubai Al Shindagha",
    "Al Mushrif Family Park, Abu Dhabi",
    "Al Awir Family Desert Farm",
    "Jumeirah Beach Private Chalet",
    "Yas Marina Family Restaurant",
    "Custom Location"
  ];

  const handleCreateGatheringSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const location = formLocationPreset === 'Custom Location' ? formLocationCustom : formLocationPreset;
    
    // Set up initial RSVP status as Pending for everyone invited
    const initialRsvp: Record<string, 'Going' | 'Maybe' | 'Not Going' | 'Pending'> = {};
    invitedIds.forEach(id => {
      initialRsvp[id] = id === 'm1' ? 'Going' : 'Pending'; // creator is going
    });

    const newGathering: Gathering = {
      id: `g_added_${Date.now()}`,
      title: formTitle,
      purpose: formPurpose || 'Family Gathering',
      date: formDate,
      time: formTime,
      location: location || 'Family Home, UAE',
      invitedMembers: invitedIds,
      rsvpStatus: initialRsvp,
      createdBy: 'm1',
      type: formType,
      notes: formNotes || undefined
    };

    setGatherings(prev => [...prev, newGathering]);
    setPlannerOpen(false);

    // Sync to Calendar Selected Date
    setSelectedDate(new Date(formDate));

    // Clear form
    setFormTitle('');
    setFormPurpose('');
    setFormDate('2026-05-20');
    setFormTime('14:00');
    setFormLocationPreset("Grandfather's Majlis, Abu Dhabi");
    setFormLocationCustom('');
    setFormNotes('');
    setInvitedIds(members.map(m => m.id));
  };

  const toggleInvitee = (id: string) => {
    setInvitedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Allow admin to toggle RSVP statuses for demonstration
  const cycleRsvp = (gatheringId: string, memberId: string) => {
    const statuses: ('Pending' | 'Going' | 'Maybe' | 'Not Going')[] = ['Pending', 'Going', 'Maybe', 'Not Going'];
    
    setGatherings(prev => prev.map(g => {
      if (g.id === gatheringId) {
        const currentStatus = g.rsvpStatus[memberId] || 'Pending';
        const nextIdx = (statuses.indexOf(currentStatus) + 1) % statuses.length;
        const nextStatus = statuses[nextIdx];
        
        return {
          ...g,
          rsvpStatus: {
            ...g.rsvpStatus,
            [memberId]: nextStatus
          }
        };
      }
      return g;
    }));
  };

  return (
    <div className="space-y-8">
      {/* Month Header */}
      <div className="flex justify-between items-baseline border-b border-sepia pb-4">
        <h2 className="font-serif text-3xl font-bold italic text-ink">{format(currentMonth, 'MMMM yyyy')}</h2>
        <div className="flex gap-4">
           <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 transition-colors hover:text-gold">
              <ChevronLeft size={20} className="text-ink/40" />
           </button>
           <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 transition-colors hover:text-gold">
              <ChevronRight size={20} className="text-ink/40" />
           </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-[2rem] border border-sepia p-6 shadow-sm">
        <div className="grid grid-cols-7 gap-1 mb-4">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-ink/20 uppercase py-2 tracking-widest">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map(day => {
            const hasEvents = allEvents.some(e => isSameDay(new Date(e.date), day));
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date('2026-05-18'));

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "h-14 relative flex flex-col items-center justify-center rounded-2xl transition-all",
                  isSelected ? "bg-ink text-white shadow-xl scale-110 z-10" : "hover:bg-sand/60",
                  isToday && !isSelected && "border border-gold text-gold"
                )}
              >
                <span className={cn("text-xs font-bold", isSelected ? "text-white" : (isToday ? "text-gold" : "text-ink"))}>
                  {format(day, 'd')}
                </span>
                {hasEvents && (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full mt-1.5",
                    isSelected ? "bg-white animate-pulse" : "bg-gold"
                  )} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Events for selected date */}
      <section className="space-y-6">
        <div className="flex justify-between items-baseline border-b border-sepia pb-4">
           <h3 className="font-serif text-2xl italic text-ink">{format(selectedDate, 'do MMMM')}</h3>
           <button 
             onClick={() => {
               setFormDate(format(selectedDate, 'yyyy-MM-dd'));
               setPlannerOpen(true);
             }}
             className="bg-ink text-white p-2.5 rounded-full hover:bg-gold transition-colors shadow-lg flex items-center gap-1.5 px-4 text-xs font-bold uppercase tracking-widest"
           >
              <Plus size={16} /> Plan Gathering
           </button>
        </div>
        
        <div className="space-y-4">
          {selectedDateEvents.length > 0 ? (
            selectedDateEvents.map(event => (
              <div 
                key={event.id} 
                className="bg-white p-6 rounded-3xl border border-sepia shadow-sm flex flex-col gap-4 group hover:border-gold transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "p-3 rounded-xl transition-all group-hover:scale-105 shrink-0",
                    event.eventType === 'Gathering' ? "bg-sand text-gold" : "bg-ink text-white"
                  )}>
                    {event.eventType === 'Gathering' ? <Users size={18} /> : <Bell size={18} />}
                  </div>
                  <div className="flex-1 space-y-1">
                     <span className="text-[8px] font-bold text-gold uppercase tracking-wider">
                       {event.eventType === 'Gathering' ? 'Family Gathering' : 'Reminders / Events'}
                     </span>
                     <h4 className="font-serif text-lg text-ink font-bold leading-tight">{event.title}</h4>
                     <div className="flex flex-wrap items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5 text-[10px] text-ink/40 font-bold uppercase tracking-widest">
                           <Clock size={12} className="text-gold" />
                           <span>{event.time}</span>
                        </div>
                        {'location' in event && (
                           <div className="flex items-center gap-1.5 text-[10px] text-ink/40 font-bold uppercase tracking-widest">
                             <MapPin size={12} className="text-gold" />
                             <span>{event.location}</span>
                          </div>
                        )}
                     </div>
                  </div>
                </div>

                {/* RSVP Details for gathering */}
                {event.eventType === 'Gathering' && (
                  <div className="border-t border-sepia/30 pt-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-bold text-ink/40 uppercase tracking-widest flex items-center gap-1">
                        <Info size={11} className="text-gold" />
                        Admin RSVP Panel (Click status to toggle simulated change)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {('invitedMembers' in event) && event.invitedMembers.map(mId => {
                        const m = members.find(member => member.id === mId);
                        if (!m) return null;
                        const status = (event as Gathering).rsvpStatus[mId] || 'Pending';

                        return (
                          <div 
                            key={mId} 
                            onClick={() => cycleRsvp(event.id, mId)}
                            className="flex items-center justify-between p-2.5 rounded-xl border border-sepia/30 hover:border-gold hover:bg-sand/35 transition-all cursor-pointer group/item"
                          >
                            <div className="flex items-center gap-2">
                              <img src={m.photo} alt={m.name} className="w-6 h-6 rounded-full object-cover border border-sepia/35" />
                              <span className="text-xs font-bold text-ink truncate w-24">{m.name.split(' ')[0]}</span>
                            </div>
                            <span className={cn(
                              "text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                              status === 'Going' && "bg-green-100 text-green-800",
                              status === 'Maybe' && "bg-yellow-100 text-yellow-800",
                              status === 'Not Going' && "bg-red-100 text-red-800",
                              status === 'Pending' && "bg-gray-100 text-gray-500"
                            )}>
                              {status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {('notes' in event) && event.notes && (
                      <p className="text-xs italic font-serif text-ink/50 bg-sand/20 border-l border-gold pl-3 py-1 mt-2">
                        Note: {event.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="bg-white/50 rounded-[2rem] p-12 text-center border border-dashed border-sepia">
               <p className="font-serif text-lg italic text-ink/40">No family plans for this day.</p>
               <button 
                 onClick={() => {
                   setFormDate(format(selectedDate, 'yyyy-MM-dd'));
                   setPlannerOpen(true);
                 }}
                 className="text-gold text-[10px] uppercase font-bold tracking-widest mt-4 hover:text-ink transition-colors"
               >
                 + Plan Gathering
               </button>
            </div>
          )}
        </div>
      </section>

      {/* Upcoming Reminders Tile - Refined */}
      <section className="bg-ink p-8 rounded-[2rem] text-white shadow-2xl relative overflow-hidden">
         <div className="relative z-10 flex justify-between items-end">
            <div className="space-y-4">
               <div className="space-y-1">
                  <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-white/40">Next Family Event</p>
                  <p className="font-serif text-2xl font-bold italic">Weekend Family Lunch</p>
               </div>
               <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gold">
                  <Clock size={12} />
                  <span>22nd May • Majlis Session</span>
               </div>
            </div>
            <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-sm">
               <CalendarIcon size={24} className="text-gold" />
            </div>
         </div>
         <div className="absolute top-0 right-0 w-32 h-32 bg-gold/5 rounded-full -mr-16 -mt-16 blur-2xl" />
      </section>

      {/* Gathering Planner Modal */}
      <AnimatePresence>
        {plannerOpen && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] border border-sepia overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <form onSubmit={handleCreateGatheringSubmit}>
                {/* Header */}
                <div className="bg-sand p-6 flex justify-between items-center border-b border-sepia">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={18} className="text-gold" />
                    <h3 className="font-serif text-xl text-ink font-bold italic">Create Gathering Invite</h3>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setPlannerOpen(false)}
                    className="p-1 rounded-full hover:bg-sepia/20 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form Body */}
                <div className="p-6 space-y-4 overflow-y-auto max-h-[55vh] custom-scrollbar text-sm text-ink">
                  {/* Title */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Gathering Title</label>
                    <input 
                      type="text"
                      required
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Eid Al Adha Iftar Dinner"
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold"
                    />
                  </div>

                  {/* Category/Type & Purpose */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Gathering Type</label>
                      <select
                        value={formType}
                        onChange={(e) => setFormType(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 focus:outline-none text-xs"
                      >
                        <option value="Majlis">Majlis Session</option>
                        <option value="Dinner">Dinner Outing</option>
                        <option value="Picnic">Park Picnic</option>
                        <option value="Volunteering">Volunteering</option>
                        <option value="Outing">Desert Excursion</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Purpose</label>
                      <input 
                        type="text"
                        value={formPurpose}
                        onChange={(e) => setFormPurpose(e.target.value)}
                        placeholder="e.g. Celebrate together"
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  {/* Date & Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Date</label>
                      <input 
                        type="date"
                        required
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Start Time</label>
                      <input 
                        type="time"
                        required
                        value={formTime}
                        onChange={(e) => setFormTime(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  {/* Location Suggestion Dropdown */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Location (UAE Spots)</label>
                    <select
                      value={formLocationPreset}
                      onChange={(e) => setFormLocationPreset(e.target.value)}
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold text-xs"
                    >
                      {locationPresets.map(preset => (
                        <option key={preset} value={preset}>{preset}</option>
                      ))}
                    </select>
                  </div>

                  {formLocationPreset === 'Custom Location' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Custom Location Name</label>
                      <input 
                        type="text"
                        required
                        value={formLocationCustom}
                        onChange={(e) => setFormLocationCustom(e.target.value)}
                        placeholder="e.g. Al Safa Park, Gate 3"
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold"
                      />
                    </div>
                  )}

                  {/* Select Invitees (Checkboxes) */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Invite Family Members</label>
                    <div className="grid grid-cols-2 gap-2 bg-sand/10 border border-sepia/40 p-3.5 rounded-2xl max-h-[140px] overflow-y-auto custom-scrollbar">
                      {members.map(member => (
                        <label 
                          key={member.id} 
                          className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-sand/30 transition-colors"
                        >
                          <input 
                            type="checkbox"
                            checked={invitedIds.includes(member.id)}
                            onChange={() => toggleInvitee(member.id)}
                            className="rounded border-sepia text-gold focus:ring-gold"
                          />
                          <img src={member.photo} alt={member.name} className="w-5 h-5 rounded-full object-cover" />
                          <span className="text-xs truncate font-medium">{member.name.split(' ')[0]}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Gathering Notes (e.g. dress code, food duties)</label>
                    <textarea 
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="e.g. Grandfather Mohammed will tell desert tales. Kids bring sports gear."
                      rows={2}
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2 focus:outline-none text-xs resize-none"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-sand border-t border-sepia flex gap-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow"
                  >
                    Send Invitations
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPlannerOpen(false)}
                    className="px-6 bg-white border border-sepia text-ink/60 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
