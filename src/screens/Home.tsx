import React, { useState } from 'react';
import { FamilyMember, Gathering } from '../types';
import { Heart, Activity, MapPin, Calendar, ArrowRight, ShieldCheck, Star, X, Clock, TrendingUp, Compass, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface HomeProps {
  members: FamilyMember[];
  gatherings: Gathering[];
  setActiveTab: (tab: string) => void;
  navigateToAssistant: (presetText: string) => void;
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
}

export function Home({ members, gatherings, setActiveTab, navigateToAssistant, setMembers }: HomeProps) {
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);

  const combinedSteps = members.reduce((sum, m) => sum + (m.healthData?.steps || 0), 0);
  const targetSteps = members.length * 10000;
  const stepPercentage = targetSteps > 0 ? Math.min((combinedSteps / targetSteps) * 100, 100) : 0;

  // Simulated location history database for UAE locations
  const locationHistoryMap: Record<string, { current: string; history: { time: string; place: string }[] }> = {
    m1: {
      current: "Al Marmoom Heritage Village, Dubai",
      history: [
        { time: "16:45", place: "Qudra Lakes Picnic Area" },
        { time: "14:15", place: "Business Bay Office Complex" },
        { time: "09:30", place: "Family Home Majlis" }
      ]
    },
    m2: {
      current: "Sheikh Zayed Grand Mosque, Abu Dhabi",
      history: [
        { time: "15:30", place: "Al Mushrif Ladies Park" },
        { time: "12:00", place: "Yas Mall Cultural Bazaar" },
        { time: "08:15", place: "Family Home Majlis" }
      ]
    },
    m3: {
      current: "Al Barari School Robotics Lab, Dubai",
      history: [
        { time: "16:00", place: "Al Khawaneej Sports Arena" },
        { time: "08:00", place: "Robotics Academy Campus" }
      ]
    },
    m4: {
      current: "Grandfather's Majlis, Abu Dhabi",
      history: [
        { time: "17:00", place: "Abu Dhabi Falcon Hospital" },
        { time: "11:30", place: "Al Khaleej Heritage Museum" },
        { time: "07:30", place: "Elders Lounge" }
      ]
    }
  };

  const activeMemberLocation = selectedMember ? (locationHistoryMap[selectedMember.id] || {
    current: "Family Home, UAE",
    history: [{ time: "12:00", place: "Home Lounge" }]
  }) : null;

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <section className="flex justify-between items-start">
        <div>
          <h2 className="font-serif text-3xl font-bold text-ink italic">Marhaba, Ahmed</h2>
          <p className="text-ink/60 text-[11px] uppercase tracking-[0.2em] mt-1 font-bold">Today in the family home</p>
        </div>
        <div className="bg-gold/10 px-4 py-2 rounded-2xl border border-gold/20 flex items-center gap-2">
          <ShieldCheck size={14} className="text-gold" />
          <span className="text-[10px] uppercase font-bold text-gold tracking-widest">Al Mansouri Admin</span>
        </div>
      </section>

      {/* AI Insight Card - Editorial Style */}
      <section className="bg-white p-8 rounded-3xl border border-sepia relative overflow-hidden shadow-sm hover:border-gold transition-all duration-300">
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-px bg-gold"></div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-gold">AI Family Advisor</span>
          </div>
          <h3 className="font-serif text-2xl italic leading-tight text-ink">
            "The heart of the home is where we gather. Grandfather Mohammed's activity is lower today; a visit to the Majlis might be refreshing."
          </h3>
          <div className="flex gap-4">
            <button 
              onClick={() => navigateToAssistant("What wellbeing activities do you suggest for Grandfather Mohammed today given his lower activity?")}
              className="px-6 py-2.5 bg-ink text-white text-[10px] uppercase tracking-[0.2em] rounded-full font-bold hover:bg-gold transition-colors"
            >
              Ask Wellbeing Advisor
            </button>
            <button 
              onClick={() => setActiveTab('tree')}
              className="px-6 py-2.5 bg-transparent border border-sepia text-ink text-[10px] uppercase tracking-[0.2em] rounded-full font-bold hover:border-gold hover:text-gold transition-colors"
            >
              Check Family Tree
            </button>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-24 h-full bg-sand flex items-center justify-center opacity-30 pointer-events-none">
          <Star size={40} className="text-gold" />
        </div>
      </section>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-sepia flex flex-col gap-3 shadow-sm hover:border-gold transition-all">
          <div className="flex items-center gap-2 text-ink/40">
            <Heart size={14} className="text-gold" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Wellbeing Index</span>
          </div>
          <p className="text-2xl font-serif italic text-ink">Stable</p>
          <div className="w-full h-1.5 bg-sand rounded-full overflow-hidden">
            <div className="w-3/4 h-full bg-gold"></div>
          </div>
          <span className="text-[9px] text-ink/40 font-bold uppercase">All members connected</span>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-sepia flex flex-col gap-3 shadow-sm hover:border-gold transition-all">
          <div className="flex items-center gap-2 text-ink/40">
            <Activity size={14} className="text-gold" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Daily Step Accumulation</span>
          </div>
          <p className="text-2xl font-serif italic text-ink">{combinedSteps.toLocaleString()} steps</p>
          <div className="w-full h-1.5 bg-sand rounded-full overflow-hidden">
            <div className="h-full bg-ink animate-pulse" style={{ width: `${stepPercentage}%` }}></div>
          </div>
          <span className="text-[9px] text-ink/40 font-bold uppercase">Target: {(targetSteps / 1000).toFixed(0)}k Combined</span>
        </div>
      </div>

      {/* Family Members Row */}
      <section>
        <div className="flex justify-between items-baseline mb-6">
          <h3 className="font-serif text-xl italic text-ink">Family Presence</h3>
          <button 
            onClick={() => setActiveTab('tree')}
            className="text-gold text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 hover:underline"
          >
            Manage Lineage <ArrowRight size={10} />
          </button>
        </div>
        <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide">
          {members.map((member) => (
            <div 
              key={member.id} 
              onClick={() => setSelectedMember(member)}
              className="flex flex-col items-center gap-3 min-w-[90px] cursor-pointer group"
            >
              <div className="relative">
                <img 
                  src={member.photo} 
                  alt={member.name} 
                  className={cn(
                    "w-16 h-16 rounded-full p-0.5 border border-sepia shadow-sm object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-300",
                    member.locationSharingStatus === 'Active' && "border-gold border-2"
                  )}
                />
                {member.locationSharingStatus === 'Active' && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gold border-2 border-white flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  </div>
                )}
              </div>
              <div className="text-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/60 group-hover:text-gold transition-colors block truncate w-20">
                  {member.name.split(' ')[0]}
                </span>
                <span className="text-[8px] text-ink/30 uppercase tracking-wider block font-semibold">
                  {member.id === 'm1' ? 'Me' : member.relationship}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming Plans */}
      <section className="space-y-6">
        <div className="flex justify-between items-baseline border-b border-sepia pb-4">
          <h3 className="font-serif text-xl italic text-ink">Upcoming Gatherings</h3>
          <button 
            onClick={() => setActiveTab('calendar')}
            className="text-[10px] uppercase font-bold tracking-widest text-gold hover:underline"
          >
            View Calendar
          </button>
        </div>
        <div className="grid gap-4">
          {gatherings.slice(0, 2).map((gathering) => (
            <div 
              key={gathering.id} 
              onClick={() => setActiveTab('calendar')}
              className="bg-white p-6 rounded-3xl border border-sepia flex flex-col gap-4 shadow-sm hover:border-gold hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-gold">{gathering.type}</p>
                  <h4 className="font-serif text-lg text-ink font-bold group-hover:text-gold transition-colors">{gathering.title}</h4>
                </div>
                <div className="text-[10px] font-bold text-ink/40 bg-sand px-3 py-1.5 rounded-xl uppercase tracking-widest">
                  {new Date(gathering.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div className="flex items-center justify-between text-ink/60 border-t border-sepia/50 pt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                  <MapPin size={12} className="text-gold" />
                  <span>{gathering.location}</span>
                </div>
                <div className="flex -space-x-2.5 items-center">
                  {gathering.invitedMembers.slice(0, 3).map(mId => {
                    const m = members.find(member => member.id === mId);
                    if (!m) return null;
                    return (
                      <img key={m.id} src={m.photo} className="w-8 h-8 rounded-full border-2 border-white object-cover shadow-sm" alt={m.name} />
                    );
                  })}
                  {gathering.invitedMembers.length > 3 && (
                    <div className="w-8 h-8 rounded-full border-2 border-white bg-sand flex items-center justify-center text-[9px] font-bold text-ink shadow-sm">
                      +{gathering.invitedMembers.length - 3}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Member Details Modal */}
      <AnimatePresence>
        {selectedMember && activeMemberLocation && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] border border-sepia overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="bg-sand p-8 flex justify-between items-start border-b border-sepia">
                <div className="flex items-center gap-5">
                  <img src={selectedMember.photo} alt={selectedMember.name} className="w-16 h-16 rounded-full object-cover border border-sepia p-0.5 bg-white shadow-sm" />
                  <div>
                    <span className="text-[9px] uppercase tracking-widest text-gold font-bold">{selectedMember.id === 'm1' ? 'Me' : selectedMember.relationship}</span>
                    <h3 className="font-serif text-2xl text-ink font-bold italic leading-tight">{selectedMember.name}</h3>
                    <p className="text-[10px] text-ink/40 font-bold uppercase tracking-widest mt-1">Age: {selectedMember.age} • Birthday: {selectedMember.birthday}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedMember(null)}
                  className="p-2 rounded-full hover:bg-sepia/20 transition-colors"
                >
                  <X size={20} className="text-ink/60" />
                </button>
              </div>

              {/* Scrollable details */}
              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {/* Health & Activity Data - Device telemetry */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-ink/40 flex items-center gap-1.5">
                      <Heart size={14} className="text-gold" />
                      Health Metrics (Apple Health / WHOOP)
                    </h4>
                    <span className="text-[9px] bg-gold/10 text-gold px-2.5 py-1 rounded-full uppercase font-bold tracking-wider">Synced Live</span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-sand p-4 rounded-2xl text-center border border-sepia/30">
                      <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Daily Steps</p>
                      <p className="text-lg font-serif italic font-bold text-ink mt-1">{(selectedMember.healthData?.steps || 0).toLocaleString()}</p>
                      <p className="text-[8px] text-gold font-bold uppercase tracking-widest mt-1">
                        {selectedMember.healthData?.steps && selectedMember.healthData.steps > 8000 ? "Goal Met" : "Active"}
                      </p>
                    </div>
                    <div className="bg-sand p-4 rounded-2xl text-center border border-sepia/30">
                      <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Sleep Hours</p>
                      <p className="text-lg font-serif italic font-bold text-ink mt-1">{selectedMember.healthData?.sleepHours || 0} hrs</p>
                      <p className="text-[8px] text-ink/40 font-bold uppercase tracking-widest mt-1">Rest Restored</p>
                    </div>
                    <div className="bg-sand p-4 rounded-2xl text-center border border-sepia/30">
                      <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Mood Indicator</p>
                      <p className="text-lg font-serif italic font-bold text-ink mt-1">{selectedMember.healthData?.mood || "N/A"}</p>
                      <p className="text-[8px] text-gold font-bold uppercase tracking-widest mt-1">Stable State</p>
                    </div>
                  </div>

                  <div className="bg-sand/30 border border-sepia/50 p-4 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TrendingUp size={16} className="text-gold" />
                      <span className="text-[10px] font-bold uppercase text-ink/60 tracking-wider">Weekly Activity Score</span>
                    </div>
                    <span className="font-serif italic font-bold text-ink">92% Optimal</span>
                  </div>
                </div>

                {/* Live Location sharing & history */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-ink/40 flex items-center gap-1.5">
                      <MapPin size={14} className="text-gold" />
                      Live Location Sharing
                    </h4>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse" />
                      <span className="text-[9px] text-gold font-bold uppercase tracking-wider">Active Stream</span>
                    </span>
                  </div>

                  {/* Mock Map View */}
                  <div className="h-32 bg-sand rounded-3xl border border-sepia/70 relative overflow-hidden flex flex-col justify-end p-4 shadow-inner">
                    <div className="absolute inset-0 opacity-25 bg-[radial-gradient(#C5A059_1px,transparent_1px)] [background-size:16px_16px]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center animate-ping absolute" />
                      <div className="w-6 h-6 rounded-full bg-gold border-2 border-white flex items-center justify-center shadow-lg relative z-10">
                        <Compass size={12} className="text-white" />
                      </div>
                    </div>
                    <div className="relative z-10 bg-white/95 backdrop-blur px-3 py-2 rounded-2xl border border-sepia max-w-[85%] mx-auto shadow-md">
                      <p className="text-[8px] font-bold uppercase text-ink/40 tracking-wider">Currently Located At</p>
                      <p className="text-[10px] font-bold text-ink truncate mt-0.5">{activeMemberLocation.current}</p>
                    </div>
                  </div>

                  {/* Location History list */}
                  <div className="space-y-3">
                    <p className="text-[9px] font-bold text-ink/40 uppercase tracking-widest pl-1">Recent Checkins (Today)</p>
                    <div className="space-y-2.5">
                      {activeMemberLocation.history.map((checkin, idx) => (
                        <div key={idx} className="flex gap-4 items-center pl-2 border-l-2 border-gold/30">
                          <Clock size={12} className="text-gold shrink-0" />
                          <div className="flex justify-between items-baseline flex-1">
                            <span className="text-[11px] font-bold text-ink">{checkin.place}</span>
                            <span className="text-[9px] text-ink/40 font-bold uppercase tracking-wider">{checkin.time}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Additional Info */}
                {selectedMember.interests && selectedMember.interests.length > 0 && (
                  <div className="space-y-3 border-t border-sepia/50 pt-6">
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-ink/40 flex items-center gap-1.5">
                      <Award size={14} className="text-gold" />
                      Personal Interests & Habits
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedMember.interests.map(interest => (
                        <span key={interest} className="bg-sand text-ink px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border border-sepia/40">
                          {interest}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions footer */}
              <div className="p-8 bg-sand border-t border-sepia flex gap-3">
                <button 
                  onClick={() => {
                    setSelectedMember(null);
                    navigateToAssistant(`What suggestions do you have for ${selectedMember.name} (Role: ${selectedMember.relationship}) regarding their wellness routine?`);
                  }}
                  className="flex-1 bg-ink text-white py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow-lg"
                >
                  Consult AI Advisor
                </button>
                {selectedMember.relationship !== 'Me' && (
                  <button 
                    onClick={() => {
                      if (confirm(`Are you sure you want to remove ${selectedMember.name} from the family group?`)) {
                        setMembers(prev => prev.filter(m => m.id !== selectedMember.id).map(m => ({
                          ...m,
                          parentIds: m.parentIds ? m.parentIds.filter(id => id !== selectedMember.id) : [],
                          childrenIds: m.childrenIds ? m.childrenIds.filter(id => id !== selectedMember.id) : [],
                          spouseId: m.spouseId === selectedMember.id ? undefined : m.spouseId,
                          spouseIds: m.spouseIds ? m.spouseIds.filter(id => id !== selectedMember.id) : []
                        })));
                        setSelectedMember(null);
                      }
                    }}
                    className="px-5 bg-red-50 text-red-600 border border-red-200 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 hover:text-red-700 transition-all"
                  >
                    Remove
                  </button>
                )}
                <button 
                  onClick={() => setSelectedMember(null)}
                  className="px-6 bg-white border border-sepia text-ink/60 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
