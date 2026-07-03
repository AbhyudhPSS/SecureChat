import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Lock, Image as ImageIcon, FileText, Mic, BellOff, Ban, Copy, Check } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { SettingsModal } from './SettingsModal';
import { UnlockModal } from './UnlockModal';
import { GroupInfoPanel } from './GroupInfoPanel';
import { CallOverlay } from './CallOverlay';
import { Avatar } from './Avatar';
import { useChat } from '../chatStore';
import { useSession } from '../store';
import { getSafetyNumber, identityKeyChanged } from '../lib/messaging';

export function ChatLayout() {
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showInfo, setShowInfo] = useState(false);
  const settingsOpen = useSession((s) => s.settingsOpen);
  const locked = useSession((s) => s.locked);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const peer = conversation?.peer ?? null;
  const peerOnline = useChat((s) => (peer ? s.online.has(peer.id) : false));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-screen gap-2.5 overflow-hidden p-2.5 md:gap-3 md:p-3"
    >
      {/* Sidebar — floating glass panel */}
      <div
        className={`${mobileView === 'chat' ? 'hidden' : 'flex'} h-full w-full overflow-hidden rounded-3xl md:flex md:w-auto`}
      >
        <Sidebar onSelect={() => setMobileView('chat')} />
      </div>

      {/* Chat — floating glass panel */}
      <div
        className={`${mobileView === 'list' ? 'hidden' : 'flex'} h-full min-w-0 flex-1 overflow-hidden rounded-3xl glass md:flex`}
      >
        <ChatArea onBack={() => setMobileView('list')} onToggleInfo={() => setShowInfo((v) => !v)} />
      </div>

      {/* Info — floating glass panel */}
      <AnimatePresence>
        {showInfo && conversation && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 336, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="hidden h-full shrink-0 overflow-hidden rounded-3xl glass lg:block"
          >
            {conversation.type === 'GROUP' ? (
              <GroupInfoPanel conversationId={conversation.id} title={conversation.title ?? 'Group'} />
            ) : peer ? (
              <InfoPanel
                userId={peer.id}
                conversationId={conversation.id}
                name={peer.displayName}
                username={peer.username}
                avatarUrl={peer.avatarUrl}
                online={peerOnline}
              />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{settingsOpen && <SettingsModal />}</AnimatePresence>
      {locked && <UnlockModal />}
      <AnimatePresence>{<CallOverlay />}</AnimatePresence>
    </motion.div>
  );
}

function InfoPanel({
  userId,
  conversationId,
  name,
  username,
  avatarUrl,
  online,
}: {
  userId: string;
  conversationId: string;
  name: string;
  username: string;
  avatarUrl?: string | null;
  online: boolean;
}) {
  const [safety, setSafety] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const messages = useChat((s) => s.messages[conversationId] ?? []);
  const keyChanged = identityKeyChanged(userId);

  useEffect(() => {
    let alive = true;
    setSafety(null);
    getSafetyNumber(userId).then((s) => alive && setSafety(s));
    return () => {
      alive = false;
    };
  }, [userId]);

  const media = { image: 0, voice: 0, file: 0 };
  for (const m of messages) {
    if (m.attachment) media[m.attachment.kind] += 1;
  }

  const copyFingerprint = () => {
    if (!safety) return;
    void navigator.clipboard?.writeText(safety).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="scroll-thin flex h-full w-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-col items-center pt-2 text-center">
        <div className="relative">
          <Avatar userId={userId} name={name} avatarUrl={avatarUrl} size={84} gradient />
          {online && (
            <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-obsidian-800 bg-emerald-400 shadow-glow" />
          )}
        </div>
        <h3 className="mt-3 text-lg font-semibold">{name}</h3>
        <p className="text-xs text-slate-400">@{username}</p>
        <span
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] ${
            online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* E2EE assurance */}
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5 text-xs text-emerald-200">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        End-to-end encrypted (X3DH + Double Ratchet)
      </div>

      {/* Shared media (computed from this device's history) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Shared</p>
        <div className="grid grid-cols-3 gap-2">
          <MediaStat icon={<ImageIcon className="h-4 w-4" />} count={media.image} label="Images" />
          <MediaStat icon={<Mic className="h-4 w-4" />} count={media.voice} label="Voice" />
          <MediaStat icon={<FileText className="h-4 w-4" />} count={media.file} label="Files" />
        </div>
      </div>

      {/* Identity-key change warning (TOFU): a pinned peer device's key changed. */}
      {keyChanged && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-rose-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Safety number changed</p>
            <p className="mt-0.5 text-xs text-rose-200/80">
              {name}’s identity key is different from the one previously verified on this device.
              This can happen after a reinstall — but it can also indicate a man-in-the-middle.
              Re-verify the safety number below with {name} out-of-band before trusting new messages.
            </p>
          </div>
        </div>
      )}

      {/* Security fingerprint */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-brand-300">
            <Lock className="h-4 w-4" /> Safety number
          </span>
          <button
            onClick={copyFingerprint}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Compare with {name} to verify there's no MITM.</p>
        <p className="mt-2 break-words font-mono text-[11px] leading-relaxed tracking-wider text-slate-300">
          {safety ?? 'Loading…'}
        </p>
      </div>

      {/* Actions */}
      <div className="mt-auto space-y-1">
        <PanelAction icon={<BellOff className="h-4 w-4" />} label={muted ? 'Unmute notifications' : 'Mute notifications'} onClick={() => setMuted((v) => !v)} active={muted} />
        <PanelAction icon={<Ban className="h-4 w-4" />} label="Block user" danger />
      </div>
    </div>
  );
}

function MediaStat({ icon, count, label }: { icon: React.ReactNode; count: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.03] py-3 text-slate-300">
      <span className="text-brand-300">{icon}</span>
      <span className="text-sm font-semibold">{count}</span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

function PanelAction({
  icon,
  label,
  onClick,
  danger,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/[0.05] ${
        danger ? 'text-rose-400' : active ? 'text-brand-300' : 'text-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
