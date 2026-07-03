import { useEffect, useRef, useState } from 'react';
import { UsersRound, UserPlus, Crown, Shield, Trash2, LogOut, Search, Loader2 } from 'lucide-react';
import type { PublicUser } from '@securechat/types';
import { useChat } from '../chatStore';
import { useSession } from '../store';
import { api } from '../lib/api';
import { addMembers, removeMember, setMemberRole, leaveConversation } from '../lib/messaging';

/** Group details + membership management (members only; mutations gated by role). */
export function GroupInfoPanel({ conversationId, title }: { conversationId: string; title: string }) {
  const detail = useChat((s) => s.details[conversationId]);
  const me = useSession((s) => s.user?.id);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const myRole = detail?.members.find((m) => m.user.id === me)?.role;
  const isAdmin = myRole === 'OWNER' || myRole === 'ADMIN';
  const memberIds = new Set(detail?.members.map((m) => m.user.id) ?? []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const users = await api.searchUsers(query.trim());
      setResults(users.filter((u) => !memberIds.has(u.id)));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll-thin flex h-full w-80 flex-col overflow-y-auto p-5">
      <div className="flex flex-col items-center text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-xl font-bold">
          {title.slice(0, 2).toUpperCase()}
        </div>
        <h3 className="mt-3 text-lg font-semibold">{title}</h3>
        <p className="text-xs text-slate-400">{detail?.members.length ?? 0} members</p>
      </div>

      {/* Add members (admins only) */}
      {isAdmin && (
        <div className="mt-5">
          {adding ? (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Add by username"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500"
                />
              </div>
              {results.map((u) => (
                <button
                  key={u.id}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await addMembers(conversationId, [u.id]);
                      setQuery('');
                      setResults([]);
                      setAdding(false);
                    })
                  }
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5"
                >
                  <UserPlus className="h-4 w-4 text-brand-400" /> {u.displayName}
                  <span className="text-xs text-slate-500">@{u.username}</span>
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-brand-300 transition hover:bg-white/[0.05]"
            >
              <UserPlus className="h-4 w-4" /> Add members
            </button>
          )}
        </div>
      )}

      {/* Member list */}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <UsersRound className="h-3.5 w-3.5" /> Members
        </p>
        {detail?.members.map((m) => {
          const isMe = m.user.id === me;
          const canManage = isAdmin && !isMe && m.role !== 'OWNER';
          return (
            <div
              key={m.user.id}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold">
                {m.user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {m.user.displayName} {isMe && <span className="text-xs text-slate-500">(you)</span>}
                </p>
                <p className="truncate text-xs text-slate-500">@{m.user.username}</p>
              </div>
              <RoleBadge role={m.role} />
              {canManage && (
                <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    title={m.role === 'ADMIN' ? 'Demote to member' : 'Promote to admin'}
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        setMemberRole(conversationId, m.user.id, m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'),
                      )
                    }
                    className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-brand-300"
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Remove from group"
                    disabled={busy}
                    onClick={() => act(() => removeMember(conversationId, m.user.id))}
                    className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => act(() => leaveConversation(conversationId))}
        disabled={busy}
        className="mt-auto flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-sm text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        Leave group
      </button>
    </div>
  );
}

function RoleBadge({ role }: { role: 'OWNER' | 'ADMIN' | 'MEMBER' }) {
  if (role === 'OWNER')
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
        <Crown className="h-3 w-3" /> Owner
      </span>
    );
  if (role === 'ADMIN')
    return (
      <span className="flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-300">
        <Shield className="h-3 w-3" /> Admin
      </span>
    );
  return null;
}
