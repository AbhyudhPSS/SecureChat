import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Loader2, Check, UsersRound } from 'lucide-react';
import type { PublicUser } from '@securechat/types';
import { api } from '../lib/api';
import { createGroup } from '../lib/messaging';

/** Create a group: pick a name and members, then start the encrypted group chat. */
export function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const users = await api.searchUsers(query.trim());
      setResults(users.filter((u) => !selected.some((s) => s.id === u.id)));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query, selected]);

  const toggle = (u: PublicUser) => {
    setSelected((s) => (s.some((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : [...s, u]));
    setQuery('');
    setResults([]);
  };

  const create = async () => {
    if (!title.trim() || selected.length === 0 || busy) return;
    setBusy(true);
    try {
      const id = await createGroup(
        title.trim(),
        selected.map((u) => u.id),
      );
      onCreated(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound className="h-5 w-5 text-brand-400" /> New group
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Group name"
          className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />

        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {selected.map((u) => (
              <button
                key={u.id}
                onClick={() => toggle(u)}
                className="flex items-center gap-1 rounded-full bg-brand-500/20 px-2.5 py-1 text-xs text-brand-200"
              >
                {u.displayName}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add people by username"
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.id}
              onClick={() => toggle(u)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/5"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold">
                {u.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{u.displayName}</p>
                <p className="truncate text-xs text-slate-500">@{u.username}</p>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={create}
          disabled={!title.trim() || selected.length === 0 || busy}
          className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Create group ({selected.length})
        </button>
      </motion.div>
    </motion.div>
  );
}
