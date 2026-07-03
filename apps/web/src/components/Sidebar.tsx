import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Settings,
  LogOut,
  ShieldCheck,
  Loader2,
  MessageSquarePlus,
  UsersRound,
  Pin,
  PinOff,
} from 'lucide-react';
import type { ConversationSummary, PublicUser } from '@securechat/types';
import { useSession } from '../store';
import { useChat } from '../chatStore';
import { logout as doLogout } from '../lib/auth';
import { api } from '../lib/api';
import { openConversation, selectConversation, teardownMessaging } from '../lib/messaging';
import { searchMessages, type MessageSearchHit } from '../lib/messageStore';
import { CreateGroupModal } from './CreateGroupModal';
import { Avatar } from './Avatar';

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function Sidebar({ onSelect }: { onSelect: (id: string) => void }) {
  const user = useSession((s) => s.user);
  const setUnauthed = useSession((s) => s.setUnauthed);
  const openSettings = useSession((s) => s.openSettings);
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const online = useChat((s) => s.online);
  const pinned = useChat((s) => s.pinned);
  const togglePin = useChat((s) => s.togglePin);
  const displayName = user?.displayName ?? 'You';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [messageHits, setMessageHits] = useState<MessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      setMessageHits([]);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const [users, hits] = await Promise.all([
          api.searchUsers(query.trim()),
          searchMessages(query.trim()),
        ]);
        setResults(users);
        setMessageHits(hits);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query]);

  const handleLogout = async () => {
    teardownMessaging();
    await doLogout({ username: user?.username });
    setUnauthed();
  };

  const startChat = async (peer: PublicUser) => {
    setQuery('');
    setResults([]);
    const id = await openConversation(peer);
    onSelect(id);
  };

  const select = (id: string) => {
    void selectConversation(id);
    onSelect(id);
  };

  const searching2 = query.trim().length >= 2;
  const pinnedConvos = conversations.filter((c) => pinned.has(c.id));
  const otherConvos = conversations.filter((c) => !pinned.has(c.id));

  return (
    <>
      <aside className="glass flex h-full w-full flex-col md:w-[340px]">
        {/* Brand + profile */}
        <div className="flex items-center justify-between gap-3 border-b hairline p-4">
          <button
            onClick={openSettings}
            className="group flex min-w-0 items-center gap-3 rounded-2xl p-1 pr-2 text-left transition hover:bg-white/5"
          >
            <div className="relative">
              <Avatar userId={user?.id} name={displayName} avatarUrl={user?.avatarUrl} size={42} gradient />
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-obsidian-900 bg-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-[11px] text-slate-400">@{user?.username}</p>
            </div>
          </button>
          <div className="flex items-center gap-0.5 text-slate-400">
            <IconButton title="New group" onClick={() => setShowCreateGroup(true)}>
              <UsersRound className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton title="Settings" onClick={openSettings}>
              <Settings className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton title="Log out" onClick={handleLogout}>
              <LogOut className="h-[18px] w-[18px]" />
            </IconButton>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people or messages"
              className="glass-input w-full py-2.5 pl-10 pr-9"
            />
            {searching && (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </span>
            )}
          </div>
        </div>

        {/* Results or conversation list */}
        <div className="scroll-thin mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {searching2 ? (
            <>
              <SearchResults results={results} onPick={startChat} />
              <MessageHits hits={messageHits} onOpen={select} query={query.trim()} />
              {results.length === 0 && messageHits.length === 0 && !searching && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">No matches found.</p>
              )}
            </>
          ) : conversations.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              No conversations yet. Search for someone or create a group to start chatting securely.
            </p>
          ) : (
            <>
              {pinnedConvos.length > 0 && (
                <Section title="Pinned" icon={<Pin className="h-3 w-3" />}>
                  {pinnedConvos.map((c) => (
                    <Row
                      key={c.id}
                      c={c}
                      active={c.id === activeId}
                      online={c.peer ? online.has(c.peer.id) : false}
                      pinned
                      onSelect={() => select(c.id)}
                      onTogglePin={() => togglePin(c.id)}
                    />
                  ))}
                </Section>
              )}
              <Section title="Recent">
                {otherConvos.map((c) => (
                  <Row
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    online={c.peer ? online.has(c.peer.id) : false}
                    pinned={false}
                    onSelect={() => select(c.id)}
                    onTogglePin={() => togglePin(c.id)}
                  />
                ))}
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t hairline px-4 py-3 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-400" />
          End-to-end encrypted
        </div>
      </aside>

      <AnimatePresence>
        {showCreateGroup && (
          <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreated={onSelect} />
        )}
      </AnimatePresence>
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <span className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}

function Row({
  c,
  active,
  online,
  pinned,
  onSelect,
  onTogglePin,
}: {
  c: ConversationSummary;
  active: boolean;
  online: boolean;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  const isGroup = c.type === 'GROUP';
  const name = c.peer?.displayName ?? c.title ?? 'Group';
  const subtitle = isGroup ? `${c.memberCount} members` : `@${c.peer?.username ?? ''}`;

  return (
    <div
      onClick={onSelect}
      className={`group relative mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition ${
        active ? 'bg-gradient-to-r from-brand-500/[0.16] to-violet-500/[0.06]' : 'hover:bg-white/[0.04]'
      }`}
    >
      {active && (
        <motion.span
          layoutId="active-rail"
          // Center vertically with auto-margins (NOT translate) so Framer's layoutId
          // transform doesn't fight the centering and knock the rail out of alignment.
          className="absolute inset-y-0 left-0.5 my-auto h-7 w-1 rounded-full bg-gradient-to-b from-brand-400 to-violet-500"
        />
      )}
      <div className="relative shrink-0">
        <span
          className={`block rounded-full ${online ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-obsidian-900' : ''}`}
        >
          <Avatar
            userId={isGroup ? undefined : c.peer?.id}
            name={name}
            avatarUrl={c.peer?.avatarUrl}
            size={44}
            gradient={isGroup}
          />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          {/* Timestamp yields its corner to the pin button when it appears (hover/pinned). */}
          <span
            className={`shrink-0 text-[10px] text-slate-500 transition-opacity ${
              pinned ? 'opacity-0' : 'group-hover:opacity-0'
            }`}
          >
            {relativeTime(c.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-400">{subtitle}</p>
          {c.unread > 0 && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-gradient-to-r from-brand-500 to-violet-500 px-1.5 text-[11px] font-semibold text-white shadow-glow">
              {c.unread}
            </span>
          )}
        </div>
      </div>
      {/* Pin toggle on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={pinned ? 'Unpin' : 'Pin'}
        className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white ${
          pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
      </button>
    </div>
  );
}

function SearchResults({ results, onPick }: { results: PublicUser[]; onPick: (u: PublicUser) => void }) {
  if (results.length === 0) return null;
  return (
    <Section title="People">
      {results.map((u) => (
        <button
          key={u.id}
          onClick={() => onPick(u)}
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-white/[0.04]"
        >
          <Avatar userId={u.id} name={u.displayName} avatarUrl={u.avatarUrl} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{u.displayName}</p>
            <p className="truncate text-xs text-slate-500">@{u.username}</p>
          </div>
          <MessageSquarePlus className="h-4 w-4 text-brand-400" />
        </button>
      ))}
    </Section>
  );
}

function MessageHits({
  hits,
  onOpen,
  query,
}: {
  hits: MessageSearchHit[];
  onOpen: (id: string) => void;
  query: string;
}) {
  if (hits.length === 0) return null;
  return (
    <Section title="Messages">
      {hits.map((h, i) => (
        <button
          key={`${h.message.id}-${i}`}
          onClick={() => onOpen(h.conversationId)}
          className="flex w-full flex-col gap-0.5 rounded-2xl px-3 py-2 text-left transition hover:bg-white/[0.04]"
        >
          <span className="truncate text-xs text-slate-300">
            {highlight(h.message.text || h.message.attachment?.name || '', query)}
          </span>
          <span className="text-[10px] text-slate-500">
            {new Date(h.message.createdAt).toLocaleDateString()}
          </span>
        </button>
      ))}
    </Section>
  );
}

function highlight(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 60);
  const start = Math.max(0, idx - 20);
  return (start > 0 ? '…' : '') + text.slice(start, start + 60);
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-xl transition hover:bg-white/[0.06] hover:text-white"
    >
      {children}
    </button>
  );
}
