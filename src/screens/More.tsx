import React from 'react';
import { Settings, Shield, Bell, Languages, LogOut, ChevronRight, HelpCircle, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { FamilyMember } from '../types';

interface MoreProps {
  members: FamilyMember[];
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
}

export function More({ members, setMembers }: MoreProps) {
  const menuItems = [
    { icon: Shield, label: 'Privacy & Safety' },
    { icon: Bell, label: 'Notifications' },
    { icon: Languages, label: 'Language: English' },
    { icon: Settings, label: 'Family Settings' },
    { icon: HelpCircle, label: 'Help & Support' },
  ];

  return (
    <div className="space-y-8">
      {/* Profile Card */}
      <div className="bg-white p-8 rounded-[2rem] border border-sepia shadow-sm flex items-center gap-6 group">
         <div className="relative">
           <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop" className="w-20 h-20 rounded-full border border-sepia p-1 shadow-md object-cover grayscale group-hover:grayscale-0 transition-all" alt="Profile" />
           <div className="absolute bottom-0 right-0 w-5 h-5 bg-gold border-2 border-white rounded-full" />
         </div>
         <div>
            <h3 className="font-serif text-2xl font-bold text-ink italic">Ahmed Al Mansouri</h3>
            <p className="text-[10px] text-ink/40 font-bold uppercase tracking-[0.2em] mt-1">Family Administrator</p>
         </div>
      </div>

      {/* Menu Options */}
      <div className="bg-white rounded-[2rem] border border-sepia overflow-hidden shadow-sm">
        {menuItems.map((item, i) => (
          <button 
            key={item.label}
            onClick={() => {
              if (item.label.includes('Language')) {
                alert("Language toggle: Arabic support is built in for all AI advice. The interface language can be set to Arabic in the next release.");
              } else {
                alert(`Settings menu: "${item.label}" panel opening soon.`);
              }
            }}
            className={cn(
              "w-full px-8 py-5 flex items-center justify-between hover:bg-sand transition-all group text-left",
              i !== menuItems.length - 1 && "border-b border-sepia"
            )}
          >
            <div className="flex items-center gap-5">
              <div className="p-3 rounded-2xl bg-sand text-ink/40 group-hover:text-gold group-hover:bg-ink transition-all">
                <item.icon size={20} />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink group-hover:text-gold transition-colors">{item.label}</span>
            </div>
            <ChevronRight size={18} className="text-ink/20 group-hover:text-gold group-hover:translate-x-1 transition-all" />
          </button>
        ))}
      </div>

      {/* Reset Family Members / Clear All (Except Me) */}
      <button 
        onClick={() => {
          if (confirm("Are you sure you want to clear all family members? This will remove everyone except you ('Ahmed Al Mansouri').")) {
            setMembers(prev => prev.filter(m => m.id === 'm1').map(m => ({
              ...m,
              parentIds: [],
              childrenIds: [],
              spouseId: undefined,
              spouseIds: [],
              siblingGroupId: undefined
            })));
            alert("All family members have been cleared except for yourself.");
          }
        }}
        className="w-full bg-red-50/70 border border-red-200 py-5 rounded-[1.5rem] flex items-center justify-center gap-3 text-red-600 font-bold text-[10px] uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all shadow-sm"
      >
        <Trash2 size={18} /> Clear All Family Members
      </button>

      {/* Sign Out */}
      <button 
        onClick={() => alert("Sign Out triggered. You will be redirected to the landing portal.")}
        className="w-full bg-ink/5 py-5 rounded-[1.5rem] flex items-center justify-center gap-3 text-ink font-bold text-[10px] uppercase tracking-widest hover:bg-gold hover:text-white transition-all shadow-sm"
      >
        <LogOut size={18} /> Sign Out
      </button>

      <div className="text-center pb-12 space-y-2">
         <p className="text-[9px] text-ink/20 font-bold uppercase tracking-[0.4em]">UAE Family Companion • v1.0.0</p>
         <p className="text-[9px] text-ink/20 italic font-serif">"Heritage & Harmony for every home"</p>
      </div>
    </div>
  );
}
