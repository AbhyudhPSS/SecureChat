import { redisPub, userChannel, PRESENCE_CHANNEL } from '../redis.js';
import type { CallSignal, Envelope } from '@securechat/types';

/**
 * Publish helpers. Realtime events are published to a recipient's user channel
 * (and presence to a global channel); whichever app instance the recipient is
 * connected to picks them up via its Redis subscriber and forwards to sockets.
 *
 * The `kind` field is the INTERNAL fan-out discriminator (not the client-facing
 * WsServerEvent.type); the gateway translates it per connected device.
 */

export interface FanoutMessage {
  kind: 'message';
  conversationId: string;
  messageId: string;
  senderUserId: string;
  senderDeviceId: string;
  createdAt: string;
  envelopes: Envelope[]; // only the recipient user's device envelopes
}

export interface FanoutTyping {
  kind: 'typing';
  conversationId: string;
  fromUserId: string;
  isTyping: boolean;
}

export interface FanoutReceipt {
  kind: 'receipt';
  conversationId: string;
  messageId: string;
  fromUserId: string;
  state: 'DELIVERED' | 'READ';
}

export interface FanoutCall {
  kind: 'call';
  fromUserId: string;
  conversationId: string;
  signal: CallSignal;
}

export type Fanout = FanoutMessage | FanoutTyping | FanoutReceipt | FanoutCall;

export async function publishToUser(recipientUserId: string, payload: Fanout): Promise<void> {
  await redisPub.publish(userChannel(recipientUserId), JSON.stringify(payload));
}

export async function publishPresence(
  userId: string,
  online: boolean,
  lastSeenAt: string,
): Promise<void> {
  await redisPub.publish(PRESENCE_CHANNEL, JSON.stringify({ userId, online, lastSeenAt }));
}
