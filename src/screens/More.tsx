import { Settings, Shield, Bell, Languages, LogOut, ChevronRight, HelpCircle, UserCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../types';

export function More({ user }: { user: AuthUser }) {
  const menuItems = [
    { icon: Shield, label: 'Privacy & Safety' },
    { icon: Bell, label: 'Notifications' },
    { icon: Languages, label: 'Language: English only' },
    { icon: Settings, label: 'Family Settings' },
    { icon: HelpCircle, label: 'Help & Support' },
  ];

  return (
    <div className="space-y-8">
      {/* Profile Card */}
      <div className="bg-white p-8 rounded-[2rem] border border-sepia shadow-sm flex items-center gap-6 group">
         <div className="relative flex size-20 items-center justify-center rounded-full border border-sepia bg-sand text-gold shadow-md">
           <UserCircle size={42} strokeWidth={1.4} />
         </div>
         <div>
            <h3 className="font-serif text-2xl font-bold text-ink italic">{user.displayName}</h3>
            <p className="text-[10px] text-ink/40 font-bold uppercase tracking-[0.2em] mt-1">{user.email}</p>
         </div>
      </div>

      {/* Menu Options */}
      <div className="bg-white rounded-[2rem] border border-sepia overflow-hidden shadow-sm">
        {menuItems.map((item, i) => (
          <button 
            key={item.label}
            onClick={() => {
              if (item.label.includes('Language')) {
                alert("The current prototype interface is English-only. Arabic localization is not connected yet.");
              } else {
                alert(`"${item.label}" is a visual placeholder and is not connected in the current prototype.`);
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

      {/* Sign Out */}
      <button 
        type="button"
        disabled
        title="Use the header control to sign out"
        className="w-full bg-ink/5 py-5 rounded-[1.5rem] flex items-center justify-center gap-3 text-ink/40 font-bold text-[10px] uppercase tracking-widest cursor-not-allowed shadow-sm"
      >
        <LogOut size={18} /> Use header to sign out
      </button>

      <div className="text-center pb-12 space-y-2">
         <p className="text-[9px] text-ink/20 font-bold uppercase tracking-[0.4em]">UAE Family Companion • Development preview</p>
         <p className="text-[9px] text-ink/20 italic font-serif">"Heritage & Harmony for every home"</p>
      </div>
    </div>
  );
}
