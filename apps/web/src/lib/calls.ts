import type { CallSignal, PublicUser } from '@securechat/types';
import { sendWs } from './ws';
import { api } from './api';
import { playConnected, startOutgoingTone, startRingtone, stopCallTone } from './sounds';
import * as km from './keyManager';
import { useChat } from '../chatStore';
import { useCall, type ActiveCall } from '../callStore';

/**
 * WebRTC call manager supporting 1:1 AND group calls via a full MESH: every
 * participant holds a direct RTCPeerConnection to every other participant, so the
 * media (DTLS-SRTP) stays end-to-end encrypted and never touches the server. Only
 * the small signaling messages are relayed by the gateway.
 *
 * Mesh coordination: the caller `invite`s members; each accepter broadcasts `join`;
 * existing participants pair up with the joiner, and the participant with the
 * smaller userId creates the offer (glare-free).
 *
 * STUN handles NAT traversal; a TURN relay is needed for symmetric NATs (prod).
 */
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const peers = new Map<string, RTCPeerConnection>();
const names = new Map<string, string>(); // userId -> display name
let localStream: MediaStream | null = null;
let invited: string[] = []; // outgoing: invited userIds not yet joined

function send(toUserId: string, conversationId: string, signal: CallSignal): void {
  sendWs({ type: 'call', toUserId, conversationId, signal });
}

function nameFor(userId: string, conversationId: string): string {
  return (
    names.get(userId) ??
    useChat.getState().details[conversationId]?.members.find((m) => m.user.id === userId)?.user
      .displayName ??
    'Participant'
  );
}

async function otherMembers(conversationId: string): Promise<string[]> {
  const me = km.current().userId;
  let detail = useChat.getState().details[conversationId];
  if (!detail) {
    try {
      detail = await api.conversationDetail(conversationId);
    } catch {
      return [];
    }
  }
  return detail.members.map((m) => m.user.id).filter((id) => id !== me);
}

function teardown(): void {
  stopCallTone();
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  for (const pc of peers.values()) pc.close();
  peers.clear();
  names.clear();
  invited = [];
  useCall.getState().clearCall();
}

function closePeer(userId: string): void {
  peers.get(userId)?.close();
  peers.delete(userId);
  useCall.getState().removeParticipant(userId);
  // Call ends once nobody is left (and we're not still ringing invitees).
  if (peers.size === 0 && invited.length === 0) teardown();
}

function ensurePeer(remoteUserId: string, callId: string, conversationId: string): RTCPeerConnection {
  const existing = peers.get(remoteUserId);
  if (existing) return existing;

  const pc = new RTCPeerConnection(ICE_CONFIG);
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream!));
  pc.onicecandidate = (e) => {
    if (e.candidate) send(remoteUserId, conversationId, { callId, kind: 'ice', candidate: e.candidate.toJSON() });
  };
  pc.ontrack = (e) => {
    useCall.getState().upsertParticipant({
      userId: remoteUserId,
      name: nameFor(remoteUserId, conversationId),
      stream: e.streams[0] ?? null,
    });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      stopCallTone();
      if (useCall.getState().call?.status !== 'connected') playConnected();
      useCall.getState().patchCall({ status: 'connected' });
    }
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(remoteUserId);
  };
  peers.set(remoteUserId, pc);
  useCall.getState().upsertParticipant({ userId: remoteUserId, name: nameFor(remoteUserId, conversationId), stream: null });
  return pc;
}

async function offerTo(remoteUserId: string, callId: string, conversationId: string): Promise<void> {
  const pc = ensurePeer(remoteUserId, callId, conversationId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(remoteUserId, conversationId, { callId, kind: 'offer', sdp: offer.sdp });
}

async function getMedia(media: 'audio' | 'video'): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: media === 'video' });
}

/** Start a call (1:1 with one target, or a group with many). */
export async function startCall(
  conversationId: string,
  targets: PublicUser[],
  media: 'audio' | 'video',
  isGroup = false,
): Promise<void> {
  if (useCall.getState().call || targets.length === 0) return;
  const callId = crypto.randomUUID();
  targets.forEach((t) => names.set(t.id, t.displayName));

  const call: ActiveCall = {
    callId,
    conversationId,
    media,
    isGroup,
    peerUserId: targets[0]!.id,
    peerName: isGroup ? 'Group call' : targets[0]!.displayName,
    direction: 'outgoing',
    status: 'ringing',
    micOn: true,
    camOn: media === 'video',
    localStream: null,
    participants: {},
  };
  useCall.getState().setCall(call);

  try {
    localStream = await getMedia(media);
    useCall.getState().patchCall({ localStream });
    startOutgoingTone();
    invited = targets.map((t) => t.id);
    for (const t of targets) send(t.id, conversationId, { callId, kind: 'invite', media, isGroup });
  } catch {
    teardown();
  }
}

/** Accept the current incoming call. */
export async function acceptCall(): Promise<void> {
  const call = useCall.getState().call;
  if (!call || call.direction !== 'incoming') return;
  stopCallTone();
  useCall.getState().patchCall({ status: 'connecting' });
  try {
    localStream = await getMedia(call.media);
    useCall.getState().patchCall({ localStream });
    // Announce our arrival; in-call participants pair up with us.
    const others = await otherMembers(call.conversationId);
    for (const uid of others) send(uid, call.conversationId, { callId: call.callId, kind: 'join' });
  } catch {
    hangup();
  }
}

export function rejectCall(): void {
  const call = useCall.getState().call;
  if (call) send(call.peerUserId, call.conversationId, { callId: call.callId, kind: 'reject' });
  teardown();
}

export function hangup(): void {
  const call = useCall.getState().call;
  if (call) {
    const targets = new Set([...peers.keys(), ...invited]);
    for (const uid of targets) send(uid, call.conversationId, { callId: call.callId, kind: 'leave' });
  }
  teardown();
}

export function toggleMic(): void {
  if (!localStream) return;
  const on = !useCall.getState().call?.micOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = on));
  useCall.getState().patchCall({ micOn: on });
}

export function toggleCam(): void {
  if (!localStream) return;
  const on = !useCall.getState().call?.camOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = on));
  useCall.getState().patchCall({ camOn: on });
}

/** Handle inbound signaling relayed by the gateway. */
export function handleCallSignal(
  fromUserId: string,
  conversationId: string,
  signal: CallSignal,
  fromName: string,
): void {
  names.set(fromUserId, fromName);
  const me = km.current().userId;
  const current = useCall.getState().call;

  if (signal.kind === 'invite') {
    if (current) {
      send(fromUserId, conversationId, { callId: signal.callId, kind: 'busy' });
      return;
    }
    useCall.getState().setCall({
      callId: signal.callId,
      conversationId,
      media: signal.media ?? 'audio',
      isGroup: signal.isGroup ?? false,
      peerUserId: fromUserId,
      peerName: fromName,
      direction: 'incoming',
      status: 'ringing',
      micOn: true,
      camOn: signal.media === 'video',
      localStream: null,
      participants: {},
    });
    startRingtone();
    return;
  }

  if (!current || current.callId !== signal.callId) return;

  switch (signal.kind) {
    case 'join':
      // A peer joined: smaller userId offers; otherwise prompt them to offer us.
      if (me < fromUserId) void offerTo(fromUserId, signal.callId, conversationId);
      else send(fromUserId, conversationId, { callId: signal.callId, kind: 'present' });
      break;
    case 'present':
      void offerTo(fromUserId, signal.callId, conversationId);
      break;
    case 'offer': {
      const pc = ensurePeer(fromUserId, signal.callId, conversationId);
      void (async () => {
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send(fromUserId, conversationId, { callId: signal.callId, kind: 'answer', sdp: answer.sdp });
      })();
      break;
    }
    case 'answer':
      void peers.get(fromUserId)?.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      break;
    case 'ice':
      if (signal.candidate) void peers.get(fromUserId)?.addIceCandidate(signal.candidate as RTCIceCandidateInit).catch(() => {});
      break;
    case 'leave':
    case 'end':
      closePeer(fromUserId);
      break;
    case 'reject':
    case 'busy':
      invited = invited.filter((id) => id !== fromUserId);
      if (!current.isGroup) teardown(); // 1:1 declined → call over
      else if (peers.size === 0 && invited.length === 0) teardown();
      break;
  }
}
