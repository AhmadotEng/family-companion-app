import React, { useState } from 'react';
import { mockActivities } from '../mockData';
import { MapPin, Clock, Filter, Search, ChevronRight, Star, X, Calendar, Sparkles, BookOpen, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { FamilyMember } from '../types';

interface ActivitiesProps {
  members: FamilyMember[];
}

export function Activities({ members }: ActivitiesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmirate, setSelectedEmirate] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [itineraryModalOpen, setItineraryModalOpen] = useState(false);

  // Form states for custom itinerary
  const [itinEmirate, setItinEmirate] = useState('Abu Dhabi');
  const [itinDuration, setItinDuration] = useState('Weekend (2 Days)');
  const [itinProfile, setItinProfile] = useState('Extended Family (with Kids & Elders)');
  const [generatedPlan, setGeneratedPlan] = useState<any>(null);

  const emirates = ['All', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Fujairah'];
  const categories = [
    { name: 'Heritage', icon: '🕌' },
    { name: 'Beach', icon: '🏖️' },
    { name: 'Parks', icon: '🌳' },
    { name: 'Museums', icon: '🏛️' }
  ];

  // Real-time filtering logic
  const filteredActivities = mockActivities.filter(activity => {
    const matchesSearch = activity.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          activity.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          activity.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesEmirate = selectedEmirate === 'All' || activity.emirate === selectedEmirate;
    const matchesCategory = selectedCategory === 'All' || activity.category === selectedCategory;
    return matchesSearch && matchesEmirate && matchesCategory;
  });

  // Simulated AI itinerary planner engine
  const handleGenerateItinerary = () => {
    // Generate beautiful day-by-day itineraries
    if (itinEmirate === 'Abu Dhabi') {
      setGeneratedPlan({
        title: `Al Mansouri Family ${itinDuration} in Abu Dhabi`,
        subtitle: `Custom plan optimized for: ${itinProfile}`,
        days: [
          {
            dayNumber: "Day 1: Cultural Grandeur",
            stops: [
              {
                time: "09:30 AM - 12:30 PM",
                title: "Louvre Abu Dhabi Museum Tour",
                description: "Wheelchair accessible paths under the stunning geometric dome. Special sensory guides for children.",
                landmark: "Saadiyat Island",
                type: "Indoor / Cultural",
                accessibility: "Elderly & Stroller Friendly"
              },
              {
                time: "01:00 PM - 03:00 PM",
                title: "Family Lunch at Saadiyat Beach Club",
                description: "Overlooking clear waters, relaxing breeze, traditional Arabic seafood menu.",
                landmark: "Saadiyat Beach",
                type: "Dining",
                accessibility: "Accessible seating"
              },
              {
                time: "04:00 PM - 06:30 PM",
                title: "Qasr Al Watan Palace Exploration",
                description: "Explore the breathtaking halls of the Presidential Palace. Extremely comfortable walking paths and indoor climate control.",
                landmark: "Al Ras Al Akhdar",
                type: "Indoor / Architecture",
                accessibility: "Fully accessible, shuttle buses available"
              }
            ]
          },
          {
            dayNumber: "Day 2: Heritage & Nature",
            stops: [
              {
                time: "10:00 AM - 12:30 PM",
                title: "Abu Dhabi Falcon Hospital",
                description: "Guided tour to see the majestic birds up close. Learn the history of falconry from old eras. Kids can hold falcons.",
                landmark: "Al Shamkha Area",
                type: "Wildlife / Education",
                accessibility: "Gentle walking pace"
              },
              {
                time: "01:30 PM - 04:30 PM",
                title: "Al Mushrif Family Park Picnic",
                description: "Relax in the shade of native Ghaf trees. Playground spaces for kids and peaceful walking trails for grandparents.",
                landmark: "Mushrif District",
                type: "Outdoor / Relaxation",
                accessibility: "Benches and paved paths"
              }
            ]
          }
        ]
      });
    } else {
      // Dubai Itinerary
      setGeneratedPlan({
        title: `Al Mansouri Family ${itinDuration} in Dubai`,
        subtitle: `Custom plan optimized for: ${itinProfile}`,
        days: [
          {
            dayNumber: "Day 1: History & Beach Bonding",
            stops: [
              {
                time: "10:00 AM - 01:00 PM",
                title: "Al Shindagha Historical Museum",
                description: "Excellent multi-sensory perfume house and history exhibits detailing Creek life. Indoor air-conditioned rooms.",
                landmark: "Dubai Creek Side",
                type: "Indoor / History",
                accessibility: "Elevators & resting points throughout"
              },
              {
                time: "03:30 PM - 08:30 PM",
                title: "Al Mamzar Beach Park Private Chalet",
                description: "Barbecue dinner and swimming. The rented air-conditioned chalet provides absolute comfort for grandparents to resting while children play by the beach.",
                landmark: "Al Mamzar Coast",
                type: "Beach / BBQ",
                accessibility: "Air-conditioned resting rooms and private toilets"
              }
            ]
          },
          {
            dayNumber: "Day 2: Desert Oasis & Wildlife",
            stops: [
              {
                time: "07:00 AM - 10:30 AM",
                title: "Al Qudra Desert Lakes Picnic",
                description: "Watch local desert gazelles and rare migratory birds. Early morning breeze avoids midday sun.",
                landmark: "Al Marmoom Reserve",
                type: "Desert / Outdoors",
                accessibility: "Drive-up viewing spots available"
              },
              {
                time: "04:30 PM - 07:00 PM",
                title: "Traditional Majlis Tea & Astronomy",
                description: "Gather under a Bedouin tent to drink gahwa, eat dates, and look at stars using telescope devices.",
                landmark: "Bab Al Shams Desert Area",
                type: "Cultural / Stargazing",
                accessibility: "Plush traditional seating"
              }
            ]
          }
        ]
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Search and Quick Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative group flex-1">
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search family experiences in UAE..."
            className="w-full bg-white border border-sepia rounded-2xl px-12 py-4 text-sm focus:outline-none shadow-sm focus:ring-1 focus:ring-gold transition-all"
          />
          <Search className="absolute left-4 top-4.5 text-ink/20 group-focus-within:text-gold transition-colors" size={18} />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-4.5 text-ink/40 hover:text-gold">
              <X size={16} />
            </button>
          )}
        </div>
        <button 
          onClick={() => setItineraryModalOpen(true)}
          className="bg-gold text-white px-5 py-4 rounded-2xl shadow-lg hover:bg-ink transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
        >
          <Sparkles size={16} /> Plan AI Itinerary
        </button>
      </div>

      {/* Emirate Selector */}
      <div className="space-y-2">
        <p className="text-[9px] font-bold text-ink/40 uppercase tracking-[0.3em] pl-1">Select Emirate</p>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {emirates.map(e => (
            <button
              key={e}
              onClick={() => setSelectedEmirate(e)}
              className={cn(
                "px-5 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all shrink-0",
                selectedEmirate === e 
                  ? "bg-ink text-white shadow-lg scale-105" 
                  : "bg-white text-ink/40 border border-sepia hover:text-ink/60 hover:border-gold"
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Small Category Grid */}
      <section className="space-y-3">
        <div className="flex justify-between items-center pl-1">
          <p className="text-[9px] font-bold text-ink/40 uppercase tracking-[0.3em]">Quick Categories</p>
          {selectedCategory !== 'All' && (
            <button 
              onClick={() => setSelectedCategory('All')} 
              className="text-[9px] text-gold font-bold uppercase tracking-wider hover:underline"
            >
              Clear Category Filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4">
          {categories.map(cat => (
            <div 
              key={cat.name} 
              onClick={() => setSelectedCategory(cat.name)}
              className={cn(
                "p-4 rounded-2xl border transition-all cursor-pointer text-center flex flex-col items-center gap-2 shadow-sm",
                selectedCategory === cat.name 
                  ? "bg-ink text-white border-ink scale-105 shadow-md" 
                  : "bg-white border-sepia hover:border-gold hover:bg-sand/30"
              )}
            >
              <span className="text-2xl">{cat.icon}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider truncate w-full">{cat.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Activities List */}
      <section className="space-y-6">
        <div className="flex justify-between items-baseline mb-2">
          <h3 className="font-serif text-2xl italic text-ink">
            {selectedCategory !== 'All' ? `${selectedCategory} in ` : 'Popular in '} 
            {selectedEmirate === 'All' ? 'UAE' : selectedEmirate}
          </h3>
          <span className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">{filteredActivities.length} places found</span>
        </div>
        
        {filteredActivities.length > 0 ? (
          <div className="grid gap-8">
            {filteredActivities.map(activity => (
              <motion.div
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                key={activity.id}
                className="bg-white rounded-[2rem] overflow-hidden border border-sepia shadow-sm group hover:shadow-xl hover:border-gold transition-all duration-300"
              >
                <div className="relative h-60 overflow-hidden">
                  <img src={activity.image} alt={activity.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute top-4 left-4 bg-white/95 backdrop-blur px-3 py-1.5 rounded-xl text-[9px] font-bold text-ink uppercase tracking-widest flex items-center gap-1.5 shadow-sm border border-sepia/20">
                    <Star size={11} className="text-gold fill-current" />
                    Family Choice
                  </div>
                  {activity.elderlyFriendly && (
                    <div className="absolute top-4 right-4 bg-ink/80 backdrop-blur px-3 py-1.5 rounded-xl text-[9px] font-bold text-white uppercase tracking-widest shadow-sm">
                      Elderly Accessible
                    </div>
                  )}
                </div>
                <div className="p-8">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[9px] font-bold text-gold uppercase tracking-wider block mb-1">{activity.category}</span>
                      <h4 className="font-serif text-2xl text-ink leading-tight font-bold group-hover:text-gold transition-colors">{activity.title}</h4>
                    </div>
                    <div className="text-[10px] font-bold text-gold bg-gold/5 px-3 py-1.5 rounded-full uppercase tracking-widest border border-gold/10">
                      {activity.priceRange}
                    </div>
                  </div>
                  <p className="text-sm text-ink/60 mb-6 leading-relaxed font-serif italic">{activity.description}</p>
                  
                  <div className="flex flex-wrap gap-x-6 gap-y-3 mb-6 border-t border-sepia/30 pt-6">
                    <div className="flex items-center gap-2 text-ink/50 text-[10px] font-bold uppercase tracking-wider">
                      <MapPin size={14} className="text-gold" />
                      <span>{activity.location}, {activity.emirate}</span>
                    </div>
                    <div className="flex items-center gap-2 text-ink/50 text-[10px] font-bold uppercase tracking-wider">
                      <Clock size={14} className="text-gold" />
                      <span>{activity.estimatedDuration}</span>
                    </div>
                    <div className="flex items-center gap-2 text-ink/50 text-[10px] font-bold uppercase tracking-wider">
                      <Sun size={14} className="text-gold" />
                      <span>{activity.weatherSuitability}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-sepia/30 pt-6">
                     <span className="text-[9px] text-ink/40 font-bold uppercase tracking-widest">Ages: {activity.ageSuitability}</span>
                     <button 
                       onClick={() => {
                         alert(`Experience details: "${activity.title}" is located at ${activity.location}. You can coordinate an invitation for this experience inside the Gatherings/Calendar tab.`);
                       }}
                       className="text-ink font-bold text-[10px] uppercase tracking-widest flex items-center gap-2 group-hover:gap-3 transition-all hover:text-gold"
                     >
                        Learn More <ChevronRight size={14} className="text-gold" />
                     </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="bg-white/50 border border-sepia border-dashed p-16 rounded-[2rem] text-center">
            <p className="font-serif text-lg italic text-ink/40">No activities match your filters.</p>
            <button 
              onClick={() => { setSelectedEmirate('All'); setSelectedCategory('All'); setSearchQuery(''); }}
              className="text-gold text-[10px] uppercase font-bold tracking-widest mt-4 hover:underline"
            >
              Reset Filters
            </button>
          </div>
        )}
      </section>

      {/* Itinerary Planner Modal */}
      <AnimatePresence>
        {itineraryModalOpen && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-[2.5rem] border border-sepia overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="bg-sand p-8 flex justify-between items-center border-b border-sepia">
                <div className="flex items-center gap-3">
                  <Sparkles size={20} className="text-gold" />
                  <h3 className="font-serif text-2xl text-ink font-bold italic">AI Family Itinerary Planner</h3>
                </div>
                <button 
                  onClick={() => { setItineraryModalOpen(false); setGeneratedPlan(null); }}
                  className="p-2 rounded-full hover:bg-sepia/20 transition-colors"
                >
                  <X size={20} className="text-ink/60" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {!generatedPlan ? (
                  // Selection Form
                  <div className="space-y-6">
                    <p className="text-sm text-ink/60 font-serif italic">
                      Generate a detailed, culturally rich itinerary for your family weekend, taking into account wheelchair accessibility, prayer schedule windows, and child activities in the UAE.
                    </p>
                    
                    {/* Select Emirate */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-ink uppercase tracking-wider block">Target Destination</label>
                      <div className="grid grid-cols-2 gap-4">
                        {['Abu Dhabi', 'Dubai'].map(dest => (
                          <button
                            key={dest}
                            type="button"
                            onClick={() => setItinEmirate(dest)}
                            className={cn(
                              "py-3 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-all",
                              itinEmirate === dest ? "bg-ink text-white border-ink shadow-sm" : "bg-white border-sepia text-ink/60 hover:border-gold"
                            )}
                          >
                            {dest}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Duration */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-ink uppercase tracking-wider block">Duration</label>
                      <div className="grid grid-cols-2 gap-4">
                        {['1 Day Plan', 'Weekend (2 Days)'].map(dur => (
                          <button
                            key={dur}
                            type="button"
                            onClick={() => setItinDuration(dur)}
                            className={cn(
                              "py-3 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-all",
                              itinDuration === dur ? "bg-ink text-white border-ink shadow-sm" : "bg-white border-sepia text-ink/60 hover:border-gold"
                            )}
                          >
                            {dur}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Participant Profile */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-ink uppercase tracking-wider block">Family Group Profile</label>
                      <div className="space-y-2">
                        {[
                          'Extended Family (with Kids & Elders)',
                          'Young Family (Parents & Kids only)',
                          'Elders Centered (Focus on walking ease & shade)'
                        ].map(prof => (
                          <button
                            key={prof}
                            type="button"
                            onClick={() => setItinProfile(prof)}
                            className={cn(
                              "w-full py-3.5 px-5 rounded-xl border text-[10px] font-bold uppercase tracking-wider text-left transition-all block",
                              itinProfile === prof ? "bg-ink text-white border-ink shadow-sm" : "bg-white border-sepia text-ink/60 hover:border-gold"
                            )}
                          >
                            {prof}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateItinerary}
                      className="w-full bg-gold text-white py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-ink transition-colors shadow-lg mt-6"
                    >
                      Generate Custom Plan
                    </button>
                  </div>
                ) : (
                  // Plan Display
                  <div className="space-y-6">
                    <div className="border-b border-sepia pb-4">
                      <h4 className="font-serif text-xl font-bold italic text-gold">{generatedPlan.title}</h4>
                      <p className="text-[10px] text-ink/40 uppercase tracking-widest font-bold mt-1">{generatedPlan.subtitle}</p>
                    </div>

                    <div className="space-y-8">
                      {generatedPlan.days.map((day: any, dIdx: number) => (
                        <div key={dIdx} className="space-y-4">
                          <h5 className="font-serif text-lg italic text-ink font-bold border-l-4 border-gold pl-3">{day.dayNumber}</h5>
                          <div className="space-y-4">
                            {day.stops.map((stop: any, sIdx: number) => (
                              <div key={sIdx} className="bg-sand/30 border border-sepia/50 p-6 rounded-2xl space-y-3">
                                <div className="flex justify-between items-start">
                                  <span className="text-[9px] font-bold text-gold uppercase tracking-wider">{stop.time}</span>
                                  <span className="text-[8px] bg-ink/5 border border-sepia text-ink/40 px-2 py-0.5 rounded font-bold uppercase">{stop.type}</span>
                                </div>
                                <h6 className="font-serif text-md font-bold text-ink">{stop.title}</h6>
                                <p className="text-xs text-ink/60 font-serif italic">{stop.description}</p>
                                <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-ink/40 pt-2 border-t border-sepia/20">
                                  <span>📍 {stop.landmark}</span>
                                  <span className="text-gold">♿ {stop.accessibility}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-8 bg-sand border-t border-sepia flex gap-4">
                {generatedPlan ? (
                  <>
                    <button 
                      onClick={() => {
                        alert(`Itinerary successfully saved to gatherings! You will now find the scheduled items inside your Family Calendar.`);
                        setItineraryModalOpen(false);
                        setGeneratedPlan(null);
                      }}
                      className="flex-1 bg-ink text-white py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow-lg"
                    >
                      Export to Family Calendar
                    </button>
                    <button 
                      onClick={() => setGeneratedPlan(null)}
                      className="px-6 bg-white border border-sepia text-ink/60 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
                    >
                      Back
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setItineraryModalOpen(false)}
                    className="w-full bg-white border border-sepia text-ink/60 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
