import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  Send,
  Check,
  CheckCheck,
  ArrowLeft,
  ShieldCheck,
  Paperclip,
  FileText,
  Download,
  Loader2,
  Smile,
  Mic,
  Trash2,
  Phone,
  Video,
  Play,
  Pause,
  Reply,
  Forward,
  X,
  Lock,
} from 'lucide-react';
import { useChat, type ChatMessage } from '../chatStore';
import { useSession } from '../store';
import { sendFile, sendText, sendTyping, sendVoice, reactToMessage } from '../lib/messaging';
import { fetchAttachmentUrl } from '../lib/attachments';
import type { AttachmentMeta, ReplyRef } from '../lib/content';
import { startRecording, formatDuration, type RecordingHandle } from '../lib/voice';
import { startCall } from '../lib/calls';
import { EmojiPicker } from './EmojiPicker';
import { Avatar } from './Avatar';
import { sendWs } from '../lib/ws';

const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '🔥'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const previewOf = (m: ChatMessage): string =>
  m.attachment ? (m.attachment.kind === 'voice' ? '🎤 Voice message' : `📎 ${m.attachment.name}`) : m.text;

export function ChatArea({ onBack, onToggleInfo }: { onBack: () => void; onToggleInfo: () => void }) {
  const activeId = useChat((s) => s.activeId);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const conversations = useChat((s) => s.conversations);
  const detail = useChat((s) => (s.activeId ? s.details[s.activeId] : undefined));
  const myId = useSession((s) => s.user?.id);
  const messages = useChat((s) => (s.activeId ? (s.messages[s.activeId] ?? []) : []));
  const peerTyping = useChat((s) => (s.activeId ? s.typing[s.activeId] : false));
  const peerOnline = useChat((s) => (conversation?.peer ? s.online.has(conversation.peer.id) : false));

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [reply, setReply] = useState<ReplyRef | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<RecordingHandle | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval>>();
  const typingRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, activeId]);

  useEffect(() => {
    setReply(null);
    setShowEmoji(false);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const lastIncoming = [...messages].reverse().find((m) => !m.fromMe && !m.undecryptable);
    if (lastIncoming) sendWs({ type: 'read', conversationId: activeId, messageId: lastIncoming.id });
  }, [activeId, messages]);

  // Auto-resize the composer textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  const isGroup = conversation?.type === 'GROUP';
  const nameFor = (userId: string): string =>
    detail?.members.find((m) => m.user.id === userId)?.user.displayName ?? 'Unknown';

  // Group consecutive messages by sender within a 5-minute window.
  const rows = useMemo(() => {
    const GAP = 5 * 60 * 1000;
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameAsPrev =
        prev && prev.senderUserId === m.senderUserId &&
        new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GAP;
      const sameAsNext =
        next && next.senderUserId === m.senderUserId &&
        new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GAP;
      return { m, startGroup: !sameAsPrev, endGroup: !sameAsNext };
    });
  }, [messages]);

  if (!conversation) {
    return (
      <section className="hidden flex-1 flex-col items-center justify-center text-center md:flex">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-500/20 to-violet-500/10 text-brand-300 shadow-glow"
        >
          <ShieldCheck className="h-9 w-9" />
        </motion.div>
        <h2 className="text-lg font-semibold">Your messages are end-to-end encrypted</h2>
        <p className="mt-1.5 max-w-sm text-sm text-slate-500">
          Search for someone, or create a group, to start a private encrypted conversation.
        </p>
      </section>
    );
  }

  const title = conversation.peer?.displayName ?? conversation.title ?? 'Conversation';

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeId) return;
    setUploading(true);
    try {
      await sendFile(activeId, file);
    } catch {
      /* reflected on optimistic message */
    } finally {
      setUploading(false);
    }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!activeId) return;
    if (!typingRef.current) {
      typingRef.current = true;
      sendTyping(activeId, true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingRef.current = false;
      sendTyping(activeId, false);
    }, 1500);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    const replyTo = reply ?? undefined;
    setDraft('');
    setReply(null);
    setShowEmoji(false);
    typingRef.current = false;
    sendTyping(activeId, false);
    setSending(true);
    try {
      await sendText(activeId, text, replyTo);
    } catch {
      /* marked failed in store */
    } finally {
      setSending(false);
    }
  };

  const beginRecording = async () => {
    try {
      recRef.current = await startRecording();
      setRecording(true);
      setRecMs(0);
      const t0 = performance.now();
      recTimer.current = setInterval(() => setRecMs(performance.now() - t0), 200);
    } catch {
      /* mic denied */
    }
  };

  const finishRecording = async (send: boolean) => {
    clearInterval(recTimer.current);
    const handle = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!handle || !activeId) return;
    if (!send) return handle.cancel();
    const { blob, durationMs } = await handle.stop();
    if (durationMs > 500) await sendVoice(activeId, blob, durationMs).catch(() => {});
  };

  const startReply = (m: ChatMessage) =>
    setReply({ id: m.id, sender: m.fromMe ? 'You' : nameFor(m.senderUserId), preview: previewOf(m).slice(0, 120) });

  const callTargets = () =>
    detail ? detail.members.filter((m) => m.user.id !== myId).map((m) => m.user) : [];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b hairline px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-white/5 md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button onClick={onToggleInfo} className="flex min-w-0 items-center gap-3 rounded-xl text-left">
            <span className={`block rounded-full ${peerOnline ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-obsidian-900' : ''}`}>
              <Avatar userId={isGroup ? undefined : conversation.peer?.id} name={title} avatarUrl={conversation.peer?.avatarUrl} size={42} gradient={isGroup} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold">{title}</p>
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
              </div>
              <p className="truncate text-xs">
                {peerTyping ? (
                  <span className="text-brand-300">typing…</span>
                ) : isGroup ? (
                  <span className="text-slate-400">{conversation.memberCount} members · encrypted</span>
                ) : peerOnline ? (
                  <span className="text-emerald-400">online</span>
                ) : (
                  <span className="text-slate-500">offline</span>
                )}
              </p>
            </div>
          </button>
        </div>
        <div className="flex items-center gap-1 text-slate-300">
          {(!isGroup ? !!conversation.peer : !!detail) && (
            <>
              <HeaderIcon
                title={isGroup ? 'Group voice call' : 'Voice call'}
                onClick={() => void startCall(conversation.id, isGroup ? callTargets() : [conversation.peer!], 'audio', isGroup)}
              >
                <Phone className="h-[18px] w-[18px]" />
              </HeaderIcon>
              <HeaderIcon
                title={isGroup ? 'Group video call' : 'Video call'}
                onClick={() => void startCall(conversation.id, isGroup ? callTargets() : [conversation.peer!], 'video', isGroup)}
              >
                <Video className="h-[18px] w-[18px]" />
              </HeaderIcon>
            </>
          )}
          <HeaderIcon title="Conversation info" onClick={onToggleInfo}>
            <Info className="h-[18px] w-[18px]" />
          </HeaderIcon>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto mb-5 flex w-fit items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400 backdrop-blur">
          <Lock className="h-3 w-3 text-emerald-400/80" />
          Messages are end-to-end encrypted
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="space-y-0.5"
          >
            {rows.map(({ m, startGroup, endGroup }, i) => (
              <MessageRow
                key={m.id}
                m={m}
                index={i}
                isGroup={!!isGroup}
                senderName={isGroup && !m.fromMe && startGroup ? nameFor(m.senderUserId) : undefined}
                showAvatar={!m.fromMe && endGroup}
                grouped={!startGroup}
                tail={endGroup}
                avatarUrl={isGroup ? undefined : conversation.peer?.avatarUrl}
                peerId={isGroup ? m.senderUserId : conversation.peer?.id}
                onReply={() => startReply(m)}
                onReact={(e) => reactToMessage(conversation.id, m.id, e)}
                onForward={() => setForwarding(m)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
        {peerTyping && <TypingDots />}
      </div>

      {/* Composer */}
      <div className="relative p-3 pt-1">
        <AnimatePresence>
          {showEmoji && <EmojiPicker onSelect={(e) => setDraft((d) => d + e)} />}
        </AnimatePresence>

        {recording ? (
          <div className="glass-card flex items-center gap-3 rounded-2xl border-rose-500/30 px-4 py-3">
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <motion.span key={d} className="h-3 w-1 rounded-full bg-rose-400" animate={{ scaleY: [0.4, 1.4, 0.4] }} transition={{ duration: 0.8, repeat: Infinity, delay: d * 0.15 }} />
              ))}
            </span>
            <span className="flex-1 text-sm text-rose-200">Recording… {formatDuration(recMs)}</span>
            <button onClick={() => void finishRecording(false)} title="Cancel" className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 hover:bg-white/10">
              <Trash2 className="h-5 w-5" />
            </button>
            <SendButton onClick={() => void finishRecording(true)} />
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-1.5">
            {reply && (
              <div className="mx-1 mt-1 flex items-start gap-2 rounded-xl border-l-2 border-brand-400/70 bg-white/[0.04] px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-brand-300">Reply to {reply.sender}</p>
                  <p className="truncate text-xs text-slate-400">{reply.preview}</p>
                </div>
                <button onClick={() => setReply(null)} className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 hover:bg-white/10">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1">
              <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
              <DockIcon onClick={() => fileRef.current?.click()} title="Attach a file" disabled={uploading}>
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
              </DockIcon>
              <DockIcon onClick={() => setShowEmoji((v) => !v)} title="Emoji" active={showEmoji}>
                <Smile className="h-5 w-5" />
              </DockIcon>
              <textarea
                ref={taRef}
                rows={1}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Write an encrypted message…"
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-slate-500"
              />
              {draft.trim() ? (
                <SendButton onClick={() => void submit()} />
              ) : (
                <DockIcon onClick={() => void beginRecording()} title="Record voice message" primary>
                  <Mic className="h-5 w-5" />
                </DockIcon>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {forwarding && (
          <ForwardModal
            message={forwarding}
            conversations={conversations.filter((c) => c.id !== conversation.id)}
            onClose={() => setForwarding(null)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function MessageRow({
  m,
  index,
  isGroup,
  senderName,
  showAvatar,
  grouped,
  tail,
  avatarUrl,
  peerId,
  onReply,
  onReact,
  onForward,
}: {
  m: ChatMessage;
  index: number;
  isGroup: boolean;
  senderName?: string;
  showAvatar: boolean;
  grouped: boolean;
  tail: boolean;
  avatarUrl?: string | null;
  peerId?: string;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onForward: () => void;
}) {
  const [showReact, setShowReact] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Keep the reaction palette open until the user picks an emoji, clicks away, or hits Escape.
  useEffect(() => {
    if (!showReact) return;
    const onDown = (e: PointerEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) setShowReact(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReact(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showReact]);

  return (
    <motion.div
      ref={rowRef}
      initial={{ opacity: 0, y: 8, x: m.fromMe ? 6 : -6 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.015, 0.15), ease: [0.22, 1, 0.36, 1] }}
      className={`group/msg flex items-end gap-2 ${grouped ? 'mt-0.5' : 'mt-3'} ${m.fromMe ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar gutter for incoming */}
      {!m.fromMe && (
        <div className="w-8 shrink-0 self-end">
          {showAvatar && <Avatar userId={isGroup ? peerId : peerId} name={senderName ?? '?'} avatarUrl={avatarUrl} size={28} gradient={isGroup} />}
        </div>
      )}

      <div className={`relative flex max-w-[78%] flex-col ${m.fromMe ? 'items-end' : 'items-start'}`}>
        {senderName && <p className="mb-0.5 ml-1 text-[11px] font-semibold text-brand-300">{senderName}</p>}

        <div
          className={`relative px-3.5 py-2.5 text-sm shadow-glass-sm ${
            m.fromMe
              ? `bg-gradient-to-br from-brand-500/90 to-violet-600/90 text-white ${tail ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'}`
              : `border border-white/[0.08] bg-white/[0.055] text-slate-100 backdrop-blur-xl ${tail ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl'}`
          } ${m.undecryptable ? 'italic opacity-70' : ''}`}
        >
          {m.replyTo && (
            <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs ${m.fromMe ? 'border-white/60 bg-black/15' : 'border-brand-400/70 bg-white/[0.05]'}`}>
              <p className="font-semibold opacity-90">{m.replyTo.sender}</p>
              <p className="truncate opacity-70">{m.replyTo.preview}</p>
            </div>
          )}
          {m.attachment && <AttachmentView att={m.attachment} fromMe={m.fromMe} />}
          {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>}
          <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.fromMe ? 'text-white/70' : 'text-slate-400'}`}>
            {time}
            {m.fromMe && <StateTick state={m.state} />}
          </div>

          {/* Hover actions */}
          <div
            className={`absolute -top-3 ${m.fromMe ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'} flex items-center gap-0.5 transition group-hover/msg:opacity-100 ${showReact ? 'opacity-100' : 'opacity-0'}`}
          >
            <ActionDot title="React" onClick={() => setShowReact((v) => !v)}><Smile className="h-3.5 w-3.5" /></ActionDot>
            <ActionDot title="Reply" onClick={onReply}><Reply className="h-3.5 w-3.5" /></ActionDot>
            <ActionDot title="Forward" onClick={onForward}><Forward className="h-3.5 w-3.5" /></ActionDot>
          </div>

          {/* Reaction palette */}
          <AnimatePresence>
            {showReact && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                className={`glass-strong absolute -top-11 z-10 flex gap-0.5 rounded-2xl px-1.5 py-1 ${m.fromMe ? 'right-0' : 'left-0'}`}
              >
                {REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      onReact(e);
                      setShowReact(false);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-xl text-lg transition hover:scale-125 hover:bg-white/10"
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Reactions */}
        {m.reactions && m.reactions.length > 0 && (
          <div className={`-mt-1.5 flex flex-wrap gap-1 ${m.fromMe ? 'justify-end' : ''}`}>
            {m.reactions.map((e) => (
              <button
                key={e}
                onClick={() => onReact(e)}
                className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs shadow-glass-sm backdrop-blur"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ActionDot({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="glass-strong grid h-7 w-7 place-items-center rounded-full text-slate-300 transition hover:text-white"
    >
      {children}
    </button>
  );
}

function AttachmentView({ att, fromMe }: { att: AttachmentMeta; fromMe: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (att.kind !== 'image') return;
    let alive = true;
    fetchAttachmentUrl(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [att]);

  if (att.kind === 'voice') return <VoicePlayer att={att} fromMe={fromMe} />;

  if (att.kind === 'image') {
    return (
      <div className="mb-1 overflow-hidden rounded-xl">
        {url ? (
          <img src={url} alt={att.name} className="max-h-72 w-full rounded-xl object-cover" />
        ) : (
          <div className="grid h-40 w-56 place-items-center bg-black/20 text-xs text-slate-300">
            {error ? 'Failed to load image' : <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        )}
      </div>
    );
  }

  const download = async () => {
    try {
      const u = await fetchAttachmentUrl(att);
      const a = document.createElement('a');
      a.href = u;
      a.download = att.name;
      a.click();
    } catch {
      setError(true);
    }
  };

  return (
    <button
      onClick={download}
      className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2 text-left ${fromMe ? 'bg-black/15' : 'bg-white/[0.05]'}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{att.name}</p>
        <p className="text-[11px] opacity-70">{error ? 'Failed' : formatBytes(att.size)}</p>
      </div>
      <Download className="ml-1 h-4 w-4 shrink-0 opacity-80" />
    </button>
  );
}

function VoicePlayer({ att, fromMe }: { att: AttachmentMeta; fromMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Stable pseudo-random bar heights for the waveform.
  const bars = useMemo(() => Array.from({ length: 30 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.65), []);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = async () => {
    if (!audioRef.current) {
      try {
        const a = new Audio(await fetchAttachmentUrl(att));
        a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
        a.onended = () => {
          setPlaying(false);
          setProgress(0);
        };
        audioRef.current = a;
      } catch {
        return;
      }
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      await audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <div className="mb-1 flex min-w-[200px] items-center gap-3">
      <button
        onClick={() => void toggle()}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${fromMe ? 'bg-white/20' : 'bg-brand-500/30 text-brand-200'}`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex h-8 flex-1 items-center gap-[2px]">
        {bars.map((h, i) => {
          const filled = i / bars.length <= progress;
          return (
            <motion.span
              key={i}
              className={`w-[2px] rounded-full ${filled ? (fromMe ? 'bg-white' : 'bg-brand-300') : fromMe ? 'bg-white/35' : 'bg-white/20'}`}
              style={{ height: `${h * 100}%` }}
              animate={playing ? { scaleY: [1, 1.25, 1] } : {}}
              transition={{ duration: 0.7, repeat: playing ? Infinity : 0, delay: (i % 6) * 0.06 }}
            />
          );
        })}
      </div>
      <span className="text-[10px] opacity-80">{att.durationMs ? formatDuration(att.durationMs) : '0:00'}</span>
    </div>
  );
}

function ForwardModal({
  message,
  conversations,
  onClose,
}: {
  message: ChatMessage;
  conversations: { id: string; type: 'DIRECT' | 'GROUP'; title: string | null; peer: { displayName: string } | null }[];
  onClose: () => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const forward = async (id: string) => {
    const text = message.text || previewOf(message);
    await sendText(id, `↪ ${text}`).catch(() => {});
    setSent(id);
    setTimeout(onClose, 700);
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
        className="glass-strong flex max-h-[70vh] w-full max-w-sm flex-col rounded-2xl p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Forward className="h-4 w-4 text-brand-300" /> Forward to</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No other conversations.</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => void forward(c.id)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/[0.05]"
            >
              {c.peer?.displayName ?? c.title ?? 'Group'}
              {sent === c.id && <Check className="h-4 w-4 text-emerald-400" />}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function HeaderIcon({ children, title, onClick }: { children: React.ReactNode; title: string; onClick?: () => void }) {
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

function DockIcon({
  children,
  title,
  onClick,
  disabled,
  active,
  primary,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition disabled:opacity-50 ${
        primary
          ? 'bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-glow hover:brightness-110 active:scale-95'
          : active
            ? 'text-brand-300'
            : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function SendButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-glow"
      title="Send"
    >
      <Send className="h-5 w-5" />
    </motion.button>
  );
}

function StateTick({ state }: { state?: ChatMessage['state'] }) {
  if (state === 'read') return <CheckCheck className="h-3 w-3 text-accent-400" />;
  if (state === 'delivered') return <CheckCheck className="h-3 w-3" />;
  if (state === 'failed') return <span className="text-rose-300">!</span>;
  if (state === 'sending') return <Loader2 className="h-3 w-3 animate-spin opacity-70" />;
  return <Check className="h-3 w-3" />;
}

function TypingDots() {
  return (
    <div className="mt-3 flex items-center gap-2 pl-10">
      <div className="flex gap-1 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.055] px-3.5 py-3 backdrop-blur-xl">
        {[0, 0.15, 0.3].map((d) => (
          <motion.span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-brand-300"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: d }}
          />
        ))}
      </div>
    </div>
  );
}
