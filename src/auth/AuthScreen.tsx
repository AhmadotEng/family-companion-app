import { FormEvent, useState } from 'react';
import { Heart, Languages, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { ApiError, authApi } from '../api/client';
import { useLanguage } from '../i18n';
import { AuthSession } from '../types';

interface AuthScreenProps {
  onAuthenticated: (session: AuthSession) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const { language, toggleLanguage, t } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = mode === 'login'
        ? await authApi.login({ email: email.trim(), password })
        : await authApi.register({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          familyName: familyName.trim()
        });
      onAuthenticated(session);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError('');
  };

  return (
    <main className="standalone-page auth-screen relative min-h-screen bg-sand px-5 py-10 flex items-center justify-center">
      <button
        type="button"
        data-no-localize
        onClick={toggleLanguage}
        className="absolute right-5 top-5 z-10 flex min-h-11 items-center gap-2 rounded-full border border-sepia bg-white px-4 text-xs font-bold text-ink shadow-sm hover:border-gold-ink"
        aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
      >
        <Languages size={17} /> {language === 'en' ? 'العربية' : 'EN'}
      </button>
      <div className="auth-card grid w-full min-w-0 max-w-5xl overflow-hidden rounded-3xl border border-sepia bg-white shadow-2xl sm:rounded-[2.5rem] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden lg:flex bg-ink text-white p-12 flex-col justify-between min-h-[650px] relative overflow-hidden">
          <div className="absolute -right-20 -bottom-20 text-gold/10"><Users size={360} /></div>
          <div className="relative">
            <img src="/assets/ailah-mark.png" alt="AILAH" className="h-24 w-24 object-contain" />
            <h1 className="font-serif text-5xl leading-tight mt-7">Your family story,<br />kept together.</h1>
            <p className="text-white/60 text-sm leading-relaxed mt-6 max-w-md">
              One shared place for your family tree, gatherings, activities and favorite moments.
            </p>
          </div>
          <div className="relative space-y-4 text-xs text-white/70">
            <p className="flex gap-3 items-center"><ShieldCheck className="text-gold" size={18} /> Private, account-protected family data</p>
            <p className="flex gap-3 items-center"><Heart className="text-gold" size={18} /> Relationships stored as a consistent family graph</p>
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-center p-5 sm:p-12">
          <div className="mb-7 sm:mb-9">
            <img src="/assets/ailah-mark.png" alt="AILAH" className="h-20 w-20 object-contain sm:h-24 sm:w-24" />
            <h2 className="mt-4 font-serif text-[1.75rem] sm:text-3xl">{t(mode === 'login' ? 'Welcome back' : 'Create your family space')}</h2>
            <p className="text-sm text-ink/50 mt-2">
              {t(mode === 'login' ? 'Sign in to continue to your family space.' : 'Create one shared place for your family tree, gatherings and memories.')}
            </p>
          </div>

          <div className="grid grid-cols-2 bg-sand rounded-xl p-1 mb-7" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-white shadow text-ink' : 'text-ink/50'}`}>{t('Sign in')}</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => changeMode('register')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-white shadow text-ink' : 'text-ink/50'}`}>{t('Register')}</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <label className="block text-sm font-semibold">
                  {t('Your name')}
                  <input required autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="Ahmed Al Mansouri" />
                </label>
                <label className="block text-sm font-semibold">
                  {t('Family space name')}
                  <input required value={familyName} onChange={event => setFamilyName(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="Al Mansouri Family" />
                </label>
              </>
            )}
            <label className="block text-sm font-semibold">
              {t('Email')}
              <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="you@example.com" />
            </label>
            <label className="block text-sm font-semibold">
              {t('Password')}
              <input required minLength={mode === 'register' ? 10 : 1} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} />
            </label>

            {error && <div role="alert" className="break-words rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <button type="submit" disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-ink disabled:opacity-50">
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              {t(mode === 'login' ? 'Sign in securely' : 'Create private space')}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
