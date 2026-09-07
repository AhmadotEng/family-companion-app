import { Bell, ChevronRight, HelpCircle, Languages, Settings, Shield, UserCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../types';

export function More({ user }: { user: AuthUser }) {
  const menuItems = [
    { icon: Shield, label: 'Privacy and safety' },
    { icon: Bell, label: 'Notifications' },
    { icon: Languages, label: 'Language: English only' },
    { icon: Settings, label: 'Family settings' },
    { icon: HelpCircle, label: 'Help and support' },
  ];

  return (
    <div className="min-w-0 space-y-4 sm:space-y-8">
      <section className="flex min-w-0 items-center gap-4 rounded-2xl border border-sepia bg-white p-4 shadow-sm sm:gap-6 sm:rounded-[2rem] sm:p-8" aria-label="Account profile">
        <div className="relative flex size-14 shrink-0 items-center justify-center rounded-full border border-sepia bg-sand text-gold shadow-sm sm:size-20 sm:shadow-md">
          <UserCircle size={34} strokeWidth={1.4} aria-hidden="true" className="sm:hidden" />
          <UserCircle size={42} strokeWidth={1.4} aria-hidden="true" className="hidden sm:block" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl font-bold italic text-ink sm:text-2xl">{user.displayName}</h3>
          <p className="mt-1 truncate text-sm text-ink/50 sm:text-xs">{user.email}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm sm:rounded-[2rem]" aria-label="Account settings">
        {menuItems.map((item, index) => (
          <button
            type="button"
            key={item.label}
            onClick={() => {
              if (item.label.includes('Language')) {
                alert('The current prototype interface is English-only. Arabic localization is not connected yet.');
              } else {
                alert(`"${item.label}" is a visual placeholder and is not connected in the current prototype.`);
              }
            }}
            className={cn(
              'group flex min-h-14 w-full min-w-0 items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-ink sm:min-h-16 sm:px-8 sm:py-4',
              index !== menuItems.length - 1 && 'border-b border-sepia',
            )}
          >
            <span className="flex min-w-0 items-center gap-3 sm:gap-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sand text-ink/45 transition-colors group-hover:bg-ink group-hover:text-gold sm:size-11 sm:rounded-2xl">
                <item.icon size={19} aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate text-sm font-semibold text-ink transition-colors group-hover:text-gold-ink">{item.label}</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink/25 transition-transform group-hover:translate-x-0.5 group-hover:text-gold-ink" />
          </button>
        ))}
      </section>

      <footer className="space-y-1.5 px-4 pb-6 text-center text-[11px] text-ink/35 sm:pb-12">
        <p>UAE Family Companion · Development preview</p>
        <p className="font-serif italic">“Heritage &amp; Harmony for every home”</p>
      </footer>
    </div>
  );
}
