import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useSession } from './store';
import { restoreSession } from './lib/auth';
import { initMessaging } from './lib/messaging';
import { AuthScreen } from './components/AuthScreen';
import { ChatLayout } from './components/ChatLayout';

export function App() {
  const status = useSession((s) => s.status);
  const setAuthed = useSession((s) => s.setAuthed);
  const setLocked = useSession((s) => s.setLocked);
  const setUnauthed = useSession((s) => s.setUnauthed);

  // Attempt silent session restore once on load (uses the httpOnly refresh cookie).
  // The ref guard + single-flighted refresh make this safe under StrictMode's
  // double-invoked effect; we deliberately do NOT cancel, so the one attempt's
  // result always lands.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    restoreSession()
      .then((result) => {
        if (!result) return setUnauthed();
        setAuthed(result.user);
        if (result.unlocked) initMessaging();
        else setLocked(true); // need the passphrase to unlock local keys
      })
      .catch(() => setUnauthed());
  }, [setAuthed, setLocked, setUnauthed]);

  // Render the active screen directly (no top-level AnimatePresence): the screen
  // switch must not depend on exit animations completing, or a backgrounded tab
  // (throttled rAF) could deadlock on the splash. Each screen animates itself in.
  if (status === 'loading') return <Splash />;
  if (status === 'authed') return <ChatLayout />;
  return <AuthScreen />;
}

function Splash() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-screen items-center justify-center"
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow"
      >
        <ShieldCheck className="h-8 w-8 text-white" />
      </motion.div>
    </motion.div>
  );
}
