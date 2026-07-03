import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useSession } from '../store';
import { register as doRegister, login as doLogin } from '../lib/auth';
import { initMessaging } from '../lib/messaging';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'signup';

const ERROR_COPY: Record<string, string> = {
  username_taken: 'That username is already taken.',
  invalid_credentials: 'Incorrect username or password.',
  invalid_input: 'Please check the highlighted fields.',
};

export function AuthScreen() {
  const setAuthed = useSession((s) => s.setAuthed);
  const [mode, setMode] = useState<Mode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!/^[a-z0-9_.]{3,32}$/.test(username))
      return 'Username must be 3–32 chars: lowercase letters, numbers, _ or .';
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (mode === 'signup' && displayName.trim().length < 1) return 'Please enter a display name.';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) return setError(v);

    setBusy(true);
    try {
      const user =
        mode === 'signup'
          ? await doRegister({ username, displayName: displayName.trim(), password })
          : await doLogin({ username, password });
      setAuthed(user);
      initMessaging(); // keys are unlocked right after login/register

    } catch (err) {
      if (err instanceof ApiError) setError(ERROR_COPY[err.code] ?? `Something went wrong (${err.code}).`);
      else setError('Could not reach the server. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
    >
      {/* Dedicated login backdrop (metallic abstract, theme-independent) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/auth-bg.jpg')" }}
      />
      {/* Legibility scrim over the backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/50 via-black/30 to-black/60"
      />

      {/* Ambient glow (neutral silver, to match the metallic backdrop) */}
      <div className="pointer-events-none absolute -top-1/4 left-1/4 h-[55vh] w-[55vh] rounded-full bg-white/10 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-1/4 right-1/4 h-[45vh] w-[45vh] rounded-full bg-white/[0.06] blur-[130px]" />

      <motion.div
        initial={{ y: 14, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong relative w-full max-w-md rounded-[2rem] p-8"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 18 }}
            className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-white to-slate-300 shadow-lg shadow-white/10"
          >
            <ShieldCheck className="h-8 w-8 text-slate-900" />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight">SecureChat</h1>
          <p className="mt-1 text-sm text-slate-400">Private by design. End-to-end encrypted.</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-1">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`relative rounded-lg py-2 text-sm font-medium transition-colors ${
                mode === m ? 'text-slate-900' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode === m && (
                <motion.span
                  layoutId="authTab"
                  className="absolute inset-0 rounded-xl bg-white shadow-lg shadow-white/20"
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <span className="relative">{m === 'login' ? 'Log in' : 'Sign up'}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <AnimatePresence initial={false}>
            {mode === 'signup' && (
              <motion.div
                key="displayName"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <Field
                  label="Display name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Jane Doe"
                  autoFocus
                />
              </motion.div>
            )}
          </AnimatePresence>
          <Field
            label="Username"
            value={username}
            onChange={(v) => setUsername(v.toLowerCase())}
            placeholder="jane_doe"
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="glass-input w-full rounded-xl py-2.5 pl-10 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-white/10 transition hover:bg-slate-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === 'login' ? 'Logging in…' : 'Creating account…'}
              </>
            ) : (
              <>
                {mode === 'login' ? 'Log in securely' : 'Create account'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
          <Lock className="h-3 w-3" />
          Your keys are generated and encrypted on this device.
        </p>
      </motion.div>
    </motion.div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="glass-input w-full rounded-xl px-3 py-2.5 text-sm"
      />
    </div>
  );
}
