import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, PhoneIncoming, ShieldCheck } from 'lucide-react';
import { useCall, type ActiveCall, type CallParticipant } from '../callStore';
import { acceptCall, rejectCall, hangup, toggleMic, toggleCam } from '../lib/calls';
import { Avatar } from './Avatar';

/** Full-screen overlay for the active call (incoming prompt + in-call mesh screen). */
export function CallOverlay() {
  const call = useCall((s) => s.call);

  // Pass `call` as a prop so the exiting CallScreen keeps its last snapshot during the
  // exit animation (the store's `call` is already null by then — reading it would crash).
  return (
    <AnimatePresence>
      {call && <CallScreen key={call.callId} call={call} />}
    </AnimatePresence>
  );
}

function CallScreen({ call }: { call: ActiveCall }) {
  const isIncomingRinging = call.direction === 'incoming' && call.status === 'ringing';
  const isVideo = call.media === 'video';
  const participants = Object.values(call.participants);
  const withVideo = participants.filter((p) => p.stream);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-obsidian-950/85 backdrop-blur-2xl" />
      <div className="pointer-events-none absolute -top-1/4 left-1/2 h-[60vh] w-[60vh] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-1/4 right-0 h-[50vh] w-[50vh] rounded-full bg-violet-500/15 blur-[120px]" />

      {/* Audio always plays for every participant (covers audio-only calls). */}
      {!isVideo && participants.map((p) => p.stream && <AudioSink key={p.userId} stream={p.stream} />)}

      {/* Video mesh grid */}
      {isVideo && withVideo.length > 0 ? (
        <div className={`relative z-10 grid h-full w-full gap-2 p-2 ${gridCols(withVideo.length)}`}>
          {withVideo.map((p) => (
            <motion.div
              key={p.userId}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-hidden rounded-3xl border border-white/10 bg-obsidian-800 shadow-glass"
            >
              <VideoTile stream={p.stream!} className="h-full w-full object-cover" />
              <span className="glass-strong absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-medium">
                {p.name}
              </span>
            </motion.div>
          ))}
        </div>
      ) : (
        // Ringing / audio call: show participant avatars + status.
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="glass-strong relative z-10 flex flex-col items-center rounded-[2rem] px-12 py-10 text-center"
        >
          <CallAvatars participants={participants} fallback={call.peerName} active={call.status === 'connected'} />
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            {call.isGroup ? 'Group call' : call.peerName}
          </h2>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-400">
            {isIncomingRinging && <PhoneIncoming className="h-4 w-4 text-brand-300" />}
            {statusLabel(call.status, call.direction, call.media)}
          </p>
          <p className="mt-4 flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-1 text-[11px] text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> End-to-end encrypted call
          </p>
        </motion.div>
      )}

      {/* Local self-view (video calls). */}
      {isVideo && call.localStream && (
        <VideoTile
          stream={call.localStream}
          muted
          className="absolute bottom-28 right-4 z-20 h-40 w-28 rounded-2xl border border-white/20 object-cover shadow-glow"
        />
      )}

      {/* Controls */}
      <div className="glass-strong absolute bottom-10 z-20 flex items-center gap-4 rounded-full px-5 py-3">
        {isIncomingRinging ? (
          <>
            <RoundButton color="rose" onClick={rejectCall} title="Decline">
              <PhoneOff className="h-6 w-6" />
            </RoundButton>
            <RoundButton color="emerald" pulse onClick={() => void acceptCall()} title="Accept">
              <Phone className="h-6 w-6" />
            </RoundButton>
          </>
        ) : (
          <>
            <RoundButton color="glass" active={!call.micOn} onClick={toggleMic} title={call.micOn ? 'Mute' : 'Unmute'}>
              {call.micOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
            </RoundButton>
            {isVideo && (
              <RoundButton color="glass" active={!call.camOn} onClick={toggleCam} title={call.camOn ? 'Camera off' : 'Camera on'}>
                {call.camOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
              </RoundButton>
            )}
            <RoundButton color="rose" onClick={hangup} title="End call">
              <PhoneOff className="h-6 w-6" />
            </RoundButton>
          </>
        )}
      </div>
    </motion.div>
  );
}

function gridCols(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

function CallAvatars({
  participants,
  fallback,
  active,
}: {
  participants: CallParticipant[];
  fallback: string;
  active: boolean;
}) {
  const list = participants.length > 0 ? participants : [{ userId: 'self', name: fallback, stream: null }];
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {list.map((p) => (
        <div key={p.userId} className="relative">
          {/* Pulsing rings while ringing/connecting. */}
          {!active && (
            <>
              <span className="absolute inset-0 -m-2 animate-ping rounded-full bg-brand-500/20" />
              <span className="absolute inset-0 -m-1 rounded-full ring-2 ring-brand-400/30" />
            </>
          )}
          {active && <span className="absolute inset-0 -m-1 rounded-full ring-2 ring-emerald-400/60" />}
          <Avatar userId={p.userId === 'self' ? undefined : p.userId} name={p.name} size={96} gradient />
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: string, direction: string, media: string): string {
  if (status === 'connected') return 'Connected';
  if (status === 'connecting') return 'Connecting…';
  if (direction === 'incoming') return `Incoming ${media} call`;
  return 'Ringing…';
}

function VideoTile({
  stream,
  muted,
  className,
}: {
  stream: MediaStream;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function AudioSink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function RoundButton({
  children,
  onClick,
  title,
  color,
  active,
  pulse,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  color: 'rose' | 'emerald' | 'glass';
  active?: boolean;
  pulse?: boolean;
}) {
  const bg =
    color === 'rose'
      ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-glow'
      : color === 'emerald'
        ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-glow'
        : active
          ? 'bg-white/90 text-obsidian-900'
          : 'bg-white/10 text-white hover:bg-white/20';
  return (
    <motion.button
      onClick={onClick}
      title={title}
      whileTap={{ scale: 0.92 }}
      className={`relative grid h-14 w-14 place-items-center rounded-full transition ${bg}`}
    >
      {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />}
      <span className="relative">{children}</span>
    </motion.button>
  );
}
