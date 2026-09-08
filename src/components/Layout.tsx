import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Calendar,
  Coins,
  Home,
  Images,
  Languages,
  LogOut,
  MapPin,
  MessageSquare,
  ShieldCheck,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../i18n';

interface LayoutProps {
  children: ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  title: string;
  onSignOut?: () => void | Promise<void>;
  onOpenLocationSettings?: () => void;
  accountName?: string;
  rewardPoints?: number;
  onOpenRewards?: () => void;
  onToggleAssistant?: () => void;
}

const primaryTabs = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'tree', icon: Users, label: 'Family' },
  { id: 'calendar', icon: Calendar, label: 'Gatherings' },
  { id: 'archive', icon: Images, label: 'Memories' },
  { id: 'activities', icon: MapPin, label: 'Activities' },
];

const accountItems = [
  { id: 'more', icon: UserCircle, label: 'Profile and account' },
  { id: 'tree', icon: ShieldCheck, label: 'Privacy and location' },
];

export function Layout({
  children,
  activeTab,
  setActiveTab,
  title,
  onSignOut,
  onOpenLocationSettings,
  accountName,
  rewardPoints,
  onOpenRewards,
  onToggleAssistant,
}: LayoutProps) {
  const { language, toggleLanguage, t } = useLanguage();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const mobileTitle = primaryTabs.find(tab => tab.id === activeTab)?.label
    ?? (activeTab === 'assistant' ? 'SILAH' : activeTab === 'more' ? 'Account' : activeTab === 'rewards' ? 'Rewards' : title);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    accountMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target) && !accountButtonRef.current?.contains(target)) {
        setAccountMenuOpen(false);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAccountMenuOpen(false);
      accountButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [accountMenuOpen]);

  const handleAccountMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const menuItems = accountMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    const items: HTMLButtonElement[] = menuItems ? Array.from(menuItems) : [];
    if (items.length === 0) return;
    event.preventDefault();
    const focusedIndex = items.findIndex(item => item === document.activeElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (focusedIndex + 1 + items.length) % items.length
          : (focusedIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const navigateFromAccountMenu = (tab: string) => {
    setAccountMenuOpen(false);
    if (tab === 'rewards') {
      onOpenRewards?.();
      return;
    }
    setActiveTab(tab);
  };

  const openLocationSettings = () => {
    // Keep a stable, connected return target for the Heritage modal focus trap.
    accountButtonRef.current?.focus();
    setAccountMenuOpen(false);
    if (onOpenLocationSettings) onOpenLocationSettings();
    else setActiveTab('tree');
  };

  return (
    <div className="relative flex h-[100dvh] max-w-full flex-col overflow-hidden bg-sand font-sans">
      <header className="app-shell-header relative z-30 flex shrink-0 items-center justify-between border-b border-sepia bg-white px-4 pb-2.5 sm:px-8 sm:pb-5">
        <div className="app-shell-brand flex min-w-0 items-center gap-2.5 sm:gap-3">
          <img src="/assets/ailah-mark.png" alt="" className="size-9 shrink-0 object-contain sm:size-12" />
          <h1 className="truncate text-xl font-semibold uppercase leading-none tracking-[0.25em] text-ink sm:text-3xl sm:tracking-[0.32em]" data-no-localize>
            AILAH
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          data-no-localize
          onClick={toggleLanguage}
          aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
          title={language === 'en' ? 'العربية' : 'English'}
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-sepia bg-sand px-3 text-xs font-bold text-ink/70 transition-colors hover:border-gold-ink hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2"
        >
          <Languages size={17} aria-hidden="true" />
          <span data-no-localize>{language === 'en' ? 'العربية' : 'EN'}</span>
        </button>
        {typeof rewardPoints === 'number' && (
          <button
            type="button"
            onClick={() => onOpenRewards?.()}
            aria-label={`${rewardPoints} reward points. Open rewards`}
            title="Rewards"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-sepia bg-sand px-3 text-sm font-semibold text-ink transition-colors hover:border-gold-ink hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2"
          >
            <Coins size={18} className="text-gold" aria-hidden="true" />
            <span className="tabular-nums">{rewardPoints.toLocaleString()}</span>
          </button>
        )}
        <div className="relative">
          <button
            ref={accountButtonRef}
            type="button"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-controls="account-menu"
            title={accountName ? `Account for ${accountName}` : 'Account'}
            onClick={() => setAccountMenuOpen(open => !open)}
            className={cn(
              'app-account-trigger flex size-11 items-center justify-center rounded-full border bg-sand text-ink/55 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 sm:size-12',
              accountMenuOpen ? 'border-gold-ink text-gold-ink' : 'border-sepia hover:border-gold-ink hover:text-ink',
            )}
          >
            <UserCircle size={27} aria-hidden="true" />
          </button>

          {accountMenuOpen && (
            <div
              ref={accountMenuRef}
              id="account-menu"
              role="menu"
              aria-label="Account menu"
              onKeyDown={handleAccountMenuKeyDown}
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-sepia bg-white p-1.5 shadow-2xl"
            >
              {accountName && (
                <p className="truncate border-b border-sepia px-3 py-2 text-xs font-semibold text-ink/55">
                  {accountName}
                </p>
              )}
              {accountItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={`${item.label}-${index}`}
                    type="button"
                    role="menuitem"
                    onClick={item.label === 'Privacy and location'
                      ? openLocationSettings
                      : () => navigateFromAccountMenu(item.id)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink/70 transition-colors hover:bg-sand hover:text-ink focus-visible:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
                  >
                    <Icon className="shrink-0 text-gold" size={18} aria-hidden="true" />
                    {t(item.label)}
                  </button>
                );
              })}
              <div className="my-1 border-t border-sepia" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  void onSignOut?.();
                }}
                disabled={!onSignOut}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <LogOut className="shrink-0" size={18} aria-hidden="true" />
                {t('Sign out')}
              </button>
            </div>
          )}
        </div>
        </div>
      </header>

      <main className={cn(
        'min-h-0 flex-1 overflow-x-hidden overscroll-y-contain',
        activeTab === 'assistant'
          ? 'overflow-y-hidden'
          : activeTab === 'tree'
            ? 'overflow-y-hidden lg:overflow-y-auto lg:scroll-smooth'
            : 'overflow-y-auto scroll-smooth',
      )} data-active-tab={activeTab}>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
          className={cn(
            'mx-auto min-w-0',
            activeTab === 'assistant'
              ? 'flex h-full flex-col overflow-hidden p-4 pb-2 sm:p-8 sm:pb-4'
              : activeTab === 'tree'
                ? 'flex h-full flex-col overflow-hidden p-4 pb-2 lg:block lg:h-auto lg:overflow-visible lg:p-8 lg:pb-10'
                : 'p-4 pb-6 sm:p-8 sm:pb-10',
            activeTab === 'tree' ? 'w-full max-w-[1600px]' : 'w-full max-w-2xl',
          )}
          data-screen={activeTab}
        >
          <div className="app-screen-heading mb-4 flex shrink-0 items-baseline justify-between border-b border-sepia pb-2.5 sm:mb-8 sm:pb-4">
            <h2 className="font-serif text-2xl text-ink sm:text-3xl">
              <span className="sm:hidden">{t(mobileTitle)}</span>
              <span className="hidden sm:inline">{title}</span>
            </h2>
          </div>
          {children}
        </motion.div>
      </main>

      <button
        type="button"
        onClick={() => onToggleAssistant?.()}
        aria-label={activeTab === 'assistant' ? 'Close SILAH' : 'Open SILAH'}
        title={t('SILAH')}
        className="absolute bottom-24 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-ink text-white shadow-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 sm:bottom-28 sm:right-8"
      >
        {activeTab === 'assistant'
          ? <X size={24} aria-hidden="true" />
          : <MessageSquare size={24} aria-hidden="true" />}
      </button>

      <nav
        aria-label="Primary navigation"
        className="app-bottom-nav relative z-20 grid shrink-0 grid-cols-5 border-t border-sepia bg-white px-1 pt-1.5 sm:px-4 sm:pt-2"
      >
        {primaryTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-ink sm:min-h-16',
                isActive ? 'bg-gold/10 text-ink' : 'text-ink/65 hover:bg-sand hover:text-ink',
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
              <span className="max-w-full truncate">{t(tab.label)}</span>
              {isActive && <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-5 rounded-full bg-gold" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
