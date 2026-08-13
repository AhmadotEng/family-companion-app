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
    <main className="min-h-screen bg-sand px-5 py-10 flex items-center justify-center">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.05fr_0.95fr] bg-white border border-sepia rounded-[2.5rem] overflow-hidden shadow-2xl">
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

        <section className="p-7 sm:p-12 flex flex-col justify-center">
          <div className="mb-9">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-gold">UAE Family Companion</p>
            <h2 className="font-serif italic text-3xl mt-3">{mode === 'login' ? 'Welcome back' : 'Create your family space'}</h2>
            <p className="text-sm text-ink/50 mt-2">
              {mode === 'login' ? 'Sign in to load your private family map.' : 'Your account starts a private family space you administer.'}
            </p>
          </div>

          <div className="grid grid-cols-2 bg-sand rounded-xl p-1 mb-7" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')} className={`rounded-lg py-2.5 text-[10px] uppercase tracking-widest font-bold ${mode === 'login' ? 'bg-white shadow text-ink' : 'text-ink/40'}`}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => changeMode('register')} className={`rounded-lg py-2.5 text-[10px] uppercase tracking-widest font-bold ${mode === 'register' ? 'bg-white shadow text-ink' : 'text-ink/40'}`}>Register</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <label className="block text-[10px] uppercase tracking-wider font-bold">
                  Your name
                  <input required autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-1.5 w-full bg-sand/40 border border-sepia rounded-xl px-4 py-3 text-sm normal-case tracking-normal font-normal focus:outline-none focus:ring-1 focus:ring-gold" placeholder="Ahmed Al Mansouri" />
                </label>
                <label className="block text-[10px] uppercase tracking-wider font-bold">
                  Family space name
                  <input required value={familyName} onChange={event => setFamilyName(event.target.value)} className="mt-1.5 w-full bg-sand/40 border border-sepia rounded-xl px-4 py-3 text-sm normal-case tracking-normal font-normal focus:outline-none focus:ring-1 focus:ring-gold" placeholder="Al Mansouri Family" />
                </label>
              </>
            )}
            <label className="block text-[10px] uppercase tracking-wider font-bold">
              Email
              <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 w-full bg-sand/40 border border-sepia rounded-xl px-4 py-3 text-sm normal-case tracking-normal font-normal focus:outline-none focus:ring-1 focus:ring-gold" placeholder="you@example.com" />
            </label>
            <label className="block text-[10px] uppercase tracking-wider font-bold">
              Password
              <input required minLength={mode === 'register' ? 10 : 1} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full bg-sand/40 border border-sepia rounded-xl px-4 py-3 text-sm normal-case tracking-normal font-normal focus:outline-none focus:ring-1 focus:ring-gold" placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} />
            </label>

            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

            <button disabled={submitting} className="w-full bg-ink text-white rounded-xl py-3.5 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-gold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              {mode === 'login' ? 'Sign in securely' : 'Create private space'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
