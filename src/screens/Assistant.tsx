import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Sparkles, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { FamilyMember } from '../types';

interface AssistantProps {
  presetInput: string;
  clearPreset: () => void;
  members: FamilyMember[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export function Assistant({ presetInput, clearPreset, members }: AssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', text: "Marhaba! I am your UAE Family Companion. I can adapt my role depending on your needs. How can I support your family today?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('Family Advisor');
  const [apiWarning, setApiWarning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Handle incoming presets
  useEffect(() => {
    if (presetInput) {
      setInput(presetInput);
      clearPreset();
      // Auto-submit after a slight delay to allow rendering
      const timer = setTimeout(() => {
        handleSend(presetInput);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [presetInput]);

  // Simulated AI response engine (UAE Cultural Context)
  const getSimulatedResponse = (query: string, currentMode: string): string => {
    const q = query.toLowerCase();
    
    if (q.includes("abu dhabi") && (q.includes("weekend") || q.includes("plan"))) {
      return `Marhaba! Here is a curated weekend family plan in Abu Dhabi, designed to respect both child energy levels and elderly accessibility:

**Day 1 (Saturday): Heritage & Culture**
* **Morning (10:00 AM):** Visit **Louvre Abu Dhabi** for a relaxed indoor art tour under the floating dome. *Tip: Wheelchairs are available free of charge for Grandfather Mohammed.*
* **Lunch (1:00 PM):** Family lunch at the Fouquet's Louvre restaurant or nearby Saadiyat Beach Club.
* **Afternoon (3:30 PM):** Tour **Qasr Al Watan** (Palace of the Nation) to admire grand Islamic architecture and library.
* **Evening (6:30 PM):** Relaxed tea and traditional snacks at a Majlis-style seating café overlooking the Corniche.

**Day 2 (Sunday): Wildlife & Outdoors**
* **Morning (9:30 AM):** Visit the **Abu Dhabi Falcon Hospital** for a unique guided tour. Sultan will love seeing the medical care of falcons, and Grandfather can share heritage poetry.
* **Afternoon (1:00 PM):** Family picnic lunch at **Al Mushrif Family Park** under the Ghaf trees.
* **Late Afternoon:** Drive back comfortably, stopping by the Sheikh Zayed Grand Mosque for Maghrib prayers.

Does this schedule suit the Al Mansouri family, or would you like to adjust the timings?`;
    }

    if (q.includes("grandparent") || q.includes("elderly") || q.includes("mohammed")) {
      return `As your ${currentMode}, I highly recommend activities that prioritize comfort, heritage, and intergenerational connection:

1. **Shared Storytelling in the Majlis:** Host a weekend tea hour. Have Sultan ask Grandfather Mohammed about old falconry techniques or life before the union of the Emirates. This preserves family heritage.
2. **Visit Al Shindagha Museum (Dubai):** This is a world-class, fully accessible indoor museum telling the story of Dubai's creek. Extremely comfortable for elders and educational for kids.
3. **Picnic at Al Mamzar Beach Park:** You can rent a private, air-conditioned chalet at Al Mamzar. This allows Grandfather Mohammed to enjoy the sea views and family atmosphere in complete cool comfort.
4. **Gentle Walk at Al Ain Oasis:** Stroll under the shaded date palm canopy using the paved, flat walkways, utilizing traditional Falaj irrigation systems as a talking point.`;
    }

    if (q.includes("ramadan") || q.includes("iftar") || q.includes("suhoor")) {
      return `Ramadan Kareem! Organizing a successful gathering for the Al Mansouri extended family:

1. **Venue Selection:** The family Majlis is ideal. If you want an outdoor experience, consider booking a private farm camp in Al Awir or Al Khawaneej, which combines privacy with traditional desert charm.
2. **Catering & Diet:** Blend classic Emirati dishes (Harees, Machboos, Luqaimat) with lighter, low-sodium options for Grandfather Mohammed. Serve fresh dates and traditional Arabic coffee (Gahwa).
3. **Invitation Timeline:** Send invitation cards 5-7 days in advance via the Gatherings tab.
4. **Gathering Spirit:** Plan a short post-Iftar trivia game about family history or Islamic traditions for the children.

Would you like me to draft a custom message template for you to send to cousins and uncles?`;
    }

    if (q.includes("invitation") || q.includes("arabic") || q.includes("polite")) {
      return `Here is a respectful, traditional invitation template in both Arabic and English, perfect for sending to your extended family:

**Arabic Version:**
« السلام عليكم ورحمة الله وبركاته،
يسرنا أن ندعوكم لمشاركتنا لقاء عائلتنا المبارك وتناول طعام الغداء في مجلس الوالد محمد، وذلك يوم الجمعة الموافق لحضوركم الكريم. حضوركم يبهج قلوبنا ويقوي روابطنا.
حفظكم الله ورعاكم. »

**English Translation:**
"Peace, mercy, and blessings of God be upon you.
We are honored to invite you to join our family gathering and lunch at Father Mohammed's Majlis this coming Friday. Your presence brings joy to our hearts and strengthens our bonds.
May God protect and bless you."

You can easily copy this and paste it directly into your gathering plan notes!`;
    }

    // Generic fallback responses based on mode
    switch (currentMode) {
      case 'Family Advisor':
        return `Marhaba! As your UAE Family Advisor, I've analyzed your request. To support the Al Mansouri family:
- Let's make sure daily schedules align with prayer times and heat restrictions, especially during summer.
- I recommend allocating Friday afternoons for extended family visits to strengthen relations (Silat al-Rahim).
- Let me know if you need help budgeting local outings or planning traditional gatherings.`;
      
      case 'Wellbeing Coach':
        return `Assalamu Alaikum! As your Wellbeing Coach, I recommend:
- Keeping track of Grandfather Mohammed's daily steps (currently 3,200). A short, indoor walk after Maghrib prayers would be highly beneficial.
- Encouraging Sultan (12, Robotics/Football) to balance screen time with active sports.
- Keeping hydration levels high across all members, aiming for 3 liters of water daily due to the local climate.`;
      
      case 'Parenting Helper':
        return `Hello! As your UAE Parenting Helper:
- For Sultan (12 years), robotics is excellent! You can enroll him in the upcoming competition at Dubai Future Labs.
- Ensure children participate in family Majlis gatherings. It teaches them traditional Emirati etiquette (Sana'a), coffee serving protocols, and respect for elders.
- If you're dealing with routine issues, let's establish a reward chart based on school achievements and helping grandparents.`;
      
      case 'Activity Planner':
        return `Marhaba! As your UAE Activity Planner, here are fresh suggestions:
- **Indoor:** Dubai Mall Aquarium, House of Artisans (Abu Dhabi), or Sharjah Discovery Centre.
- **Outdoor (Best in cooler months):** Hatta Kayaking, Al Qudra Lakes, or archaeological walks at Mleiha Heritage Site.
- **Volunteering:** Register the family on the volunteers.ae portal for community work in Dubai or Abu Dhabi.`;
      
      default:
        return `I am here to assist the Al Mansouri family. Please ask me about UAE activity plans, heritage gathering schedules, or general wellbeing advice.`;
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const messageText = overrideInput || input;
    if (!messageText.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setApiWarning(false);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          context: { familyName: "Al Mansouri Family", members: members.map(m => m.name) },
          mode
        })
      });
      
      if (!response.ok) {
        throw new Error("API not configured or server error");
      }

      const data = await response.json();
      const assistantMsg: Message = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        text: data.text || "I'm sorry, I encountered an issue." 
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.log("Using simulated advisor fallback:", error);
      // Trigger a visual warning but proceed with highly accurate local simulated response
      setApiWarning(true);
      
      // Add slight typing delay to feel organic
      setTimeout(() => {
        const fallbackText = getSimulatedResponse(messageText, mode);
        const assistantMsg: Message = { 
          id: (Date.now() + 1).toString(), 
          role: 'assistant', 
          text: fallbackText 
        };
        setMessages(prev => [...prev, assistantMsg]);
        setIsLoading(false);
      }, 800);
      return; // Return early as setTimeout handles loading
    }
    setIsLoading(false);
  };

  const suggestions = [
    "Plan a family weekend in Abu Dhabi",
    "Suggest activities for grandparents",
    "Help organize a Ramadan gathering",
    "Polite invitation in Arabic"
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      {/* Mode Selector */}
      <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide shrink-0">
        {['Family Advisor', 'Wellbeing Coach', 'Parenting Helper', 'Activity Planner'].map((role) => (
          <button
            key={role}
            onClick={() => setMode(role)}
            className={cn(
              "px-5 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap",
              mode === role 
                ? "bg-ink text-white shadow-xl scale-105" 
                : "bg-white text-ink/40 border border-sepia hover:border-gold hover:text-ink/60"
            )}
          >
            {role}
          </button>
        ))}
      </div>

      {/* API Key Fallback Notice */}
      {apiWarning && (
        <div className="bg-gold/10 border border-gold/20 p-3.5 rounded-2xl mb-4 flex items-center gap-3 shrink-0">
          <AlertCircle size={16} className="text-gold shrink-0" />
          <p className="text-[10px] font-bold text-gold uppercase tracking-wider leading-relaxed">
            Running in Offline Sandbox Mode • Generates offline UAE cultural insights
          </p>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-6 pr-2 custom-scrollbar">
        {messages.map((msg) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={msg.id}
            className={cn(
              "flex items-start gap-4 max-w-[90%]",
              msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm border",
              msg.role === 'user' ? "bg-ink border-ink" : "bg-white border-sepia"
            )}>
              <span className="text-xs font-bold">{msg.role === 'user' ? 'UA' : 'AI'}</span>
            </div>
            <div className={cn(
              "p-5 rounded-3xl text-sm leading-relaxed shadow-sm whitespace-pre-line",
              msg.role === 'user' 
                ? "bg-ink text-white rounded-tr-none" 
                : "bg-white text-ink border border-sepia rounded-tl-none font-serif italic"
            )}>
              {msg.text}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 pl-4">
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-2 h-2 rounded-full bg-gold" />
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-2 h-2 rounded-full bg-gold" />
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-2 h-2 rounded-full bg-gold" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length < 3 && (
        <div className="mb-4 space-y-2.5 shrink-0">
          <p className="text-[9px] font-bold text-ink/40 uppercase tracking-[0.3em] pl-1">Quick Prompts</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="bg-white border border-sepia px-4 py-2.5 rounded-xl text-[10px] uppercase font-bold tracking-widest text-ink/60 hover:border-gold hover:text-gold transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="relative group shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={`Ask the ${mode}...`}
          className="w-full bg-white border border-sepia rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-1 focus:ring-gold shadow-sm pr-14 text-ink"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          className="absolute right-2 top-2 p-3 bg-ink text-white rounded-xl shadow-lg disabled:opacity-30 disabled:grayscale transition-all active:scale-95 hover:bg-gold"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
