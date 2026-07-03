import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Loader2, ShieldCheck } from 'lucide-react';
import { useSession } from '../store';
import { unlock as doUnlock, logout as doLogout } from '../lib/auth';
import { initMessaging } from '../lib/messaging';

/**
 * After a reload the API session is restored from the refresh cookie, but the
 * local E2EE keys are encrypted at rest — the user re-enters their password to
 * derive the wrapping key and unlock them. (The password is never sent anywhere.)
 */
export function UnlockModal() {
  const user = useSession((s) => s.user);
  const setLocked = useSession((s) => s.setLocked);
  const setUnauthed = useSession((s) => s.setUnauthed);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await doUnlock(user.username, password);
      if (!ok) {
        setError('Incorrect password, or keys not found on this device.');
        return;
      }
      setLocked(false);
      initMessaging();
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await doLogout({ username: user?.username });
    setUnauthed();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="glass w-full max-w-sm rounded-3xl p-8 text-center shadow-glow"
      >
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow">
          <ShieldCheck className="h-7 w-7 text-white" />
        </div>
        <h2 className="text-lg font-semibold">Welcome back{user ? `, ${user.displayName}` : ''}</h2>
        <p className="mt-1 text-sm text-slate-400">Enter your password to unlock your encrypted messages.</p>

        <form onSubmit={submit} className="mt-6 space-y-3 text-left">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Unlock
          </button>
        </form>
        <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-slate-300">
          Sign out instead
        </button>
      </motion.div>
    </motion.div>
  );
}
