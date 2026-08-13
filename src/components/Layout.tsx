import type { ReactNode } from 'react';
import { Archive, Home, MessageSquare, MapPin, Users, Calendar, UserCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface LayoutProps {
  children: ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  title: string;
}

export function Layout({ children, activeTab, setActiveTab, title }: LayoutProps) {
  const tabs = [
    { id: 'home', icon: Home, label: 'Dashboard' },
    { id: 'assistant', icon: MessageSquare, label: 'AI Helper' },
    { id: 'activities', icon: MapPin, label: 'Activities' },
    { id: 'tree', icon: Users, label: 'Heritage' },
    { id: 'calendar', icon: Calendar, label: 'Gatherings' },
    { id: 'archive', icon: Archive, label: 'Archive' },
  ];

  return (
    <div className="flex flex-col h-screen bg-sand font-sans overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 bg-white border-b border-sepia flex justify-between items-end sticky top-0 z-20">
        <div>
          <h1 className="font-serif text-2xl font-bold tracking-tight leading-none text-ink">
            UAE FAMILY<br/>
            <span className="text-gold uppercase text-lg tracking-widest font-sans font-normal opacity-80">Companion</span>
          </h1>
          <p className="text-[10px] uppercase tracking-widest mt-2 opacity-40 font-bold">Heritage & Harmony</p>
        </div>
        <button aria-label="Open profile and settings" onClick={() => setActiveTab('more')} className="w-12 h-12 rounded-full bg-sand border border-sepia flex items-center justify-center overflow-hidden hover:scale-105 transition-transform">
             <UserCircle size={28} className="text-ink/50" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 scroll-smooth">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={cn(
            "p-8 mx-auto",
            activeTab === 'tree' ? "w-full max-w-[1600px]" : "max-w-2xl"
          )}
        >
          <div className="mb-8 flex justify-between items-baseline border-b border-sepia pb-4">
             <h2 className="font-serif text-3xl italic text-ink">{title}</h2>
             <span className="text-[10px] uppercase tracking-widest opacity-40 font-bold">UAE / {activeTab}</span>
          </div>
          {children}
        </motion.div>
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 w-full bg-white border-t border-sepia px-4 py-4 flex justify-around items-center z-10 pb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 transition-all relative",
                isActive ? "text-ink" : "text-ink/40 hover:text-ink/60"
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[9px] font-bold uppercase tracking-widest">{tab.label}</span>
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute -bottom-2 w-1.5 h-1.5 rounded-full bg-gold"
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
