import { FormEvent, useState } from 'react';
import { Heart, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { ApiError, authApi } from '../api/client';
import { AuthSession } from '../types';

interface AuthScreenProps {
  onAuthenticated: (session: AuthSession) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
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
    <main className="standalone-page auth-screen min-h-screen bg-sand px-5 py-10 flex items-center justify-center">
      <div className="auth-card grid w-full min-w-0 max-w-5xl overflow-hidden rounded-3xl border border-sepia bg-white shadow-2xl sm:rounded-[2.5rem] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden lg:flex bg-ink text-white p-12 flex-col justify-between min-h-[650px] relative overflow-hidden">
          <div className="absolute -right-20 -bottom-20 text-gold/10"><Users size={360} /></div>
          <div className="relative">
            <p className="text-gold uppercase tracking-[0.35em] text-[10px] font-bold">Heritage & Harmony</p>
            <h1 className="font-serif italic text-5xl leading-tight mt-5">Your family story,<br />kept private.</h1>
            <p className="text-white/60 text-sm leading-relaxed mt-6 max-w-md">
              Build a shared family map that persists when you return to this server. Only signed-in members of your family can access it.
            </p>
          </div>
          <div className="relative space-y-4 text-xs text-white/70">
            <p className="flex gap-3 items-center"><ShieldCheck className="text-gold" size={18} /> Private, account-protected family data</p>
            <p className="flex gap-3 items-center"><Heart className="text-gold" size={18} /> Relationships stored as a consistent family graph</p>
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-center p-5 sm:p-12">
          <div className="mb-7 sm:mb-9">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-gold-ink">UAE Family Companion</p>
            <h2 className="mt-3 font-serif text-[1.75rem] italic sm:text-3xl">{mode === 'login' ? 'Welcome back' : 'Create your family space'}</h2>
            <p className="text-sm text-ink/50 mt-2">
              {mode === 'login' ? 'Sign in to load your private family map.' : 'Your account starts a private family space you administer.'}
            </p>
          </div>

          <div className="grid grid-cols-2 bg-sand rounded-xl p-1 mb-7" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-white shadow text-ink' : 'text-ink/50'}`}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => changeMode('register')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-white shadow text-ink' : 'text-ink/50'}`}>Register</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <label className="block text-sm font-semibold">
                  Your name
                  <input required autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="Ahmed Al Mansouri" />
                </label>
                <label className="block text-sm font-semibold">
                  Family space name
                  <input required value={familyName} onChange={event => setFamilyName(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="Al Mansouri Family" />
                </label>
              </>
            )}
            <label className="block text-sm font-semibold">
              Email
              <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder="you@example.com" />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input required minLength={mode === 'register' ? 10 : 1} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base font-normal focus:outline-none focus:ring-1 focus:ring-gold-ink" placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} />
            </label>

            {error && <div role="alert" className="break-words rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <button type="submit" disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-ink disabled:opacity-50">
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              {mode === 'login' ? 'Sign in securely' : 'Create private space'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
