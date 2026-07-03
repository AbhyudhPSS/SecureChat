import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { wsClientEventSchema, type WsServerEvent } from '@securechat/types';
import { verifyAccessToken } from '../auth/tokens.js';
import { prisma } from '../db.js';
import {
  PRESENCE_CHANNEL,
  markOffline,
  markOnline,
  onlineFrom,
  redisSub,
  refreshOnline,
  userChannel,
} from '../redis.js';
import { publishPresence, publishToUser, type Fanout } from './bus.js';
import { isMember, otherMemberUserIds } from '../conversations/service.js';

interface Conn {
  userId: string;
  deviceId: string;
  socket: WebSocket;
}

// Connections on THIS instance, grouped by user. Cross-instance reach is via Redis.
const local = new Map<string, Set<Conn>>();

function send(socket: WebSocket, event: WsServerEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

function addLocal(conn: Conn): void {
  let set = local.get(conn.userId);
  if (!set) {
    set = new Set();
    local.set(conn.userId, set);
    // First connection for this user on this instance → subscribe to their channel.
    void redisSub.subscribe(userChannel(conn.userId));
  }
  set.add(conn);
}

function removeLocal(conn: Conn): void {
  const set = local.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    local.delete(conn.userId);
    void redisSub.unsubscribe(userChannel(conn.userId));
  }
}

/** Deliver an internal fan-out payload to a user's local sockets. */
async function deliverToUser(userId: string, payload: Fanout): Promise<void> {
  const set = local.get(userId);
  if (!set || set.size === 0) return;

  if (payload.kind === 'typing') {
    for (const conn of set) {
      send(conn.socket, {
        type: 'typing',
        conversationId: payload.conversationId,
        userId: payload.fromUserId,
        isTyping: payload.isTyping,
      });
    }
    return;
  }

  if (payload.kind === 'receipt') {
    for (const conn of set) {
      send(conn.socket, {
        type: 'receipt',
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        userId: payload.fromUserId,
        state: payload.state,
      });
    }
    return;
  }

  if (payload.kind === 'call') {
    for (const conn of set) {
      send(conn.socket, {
        type: 'call',
        fromUserId: payload.fromUserId,
        conversationId: payload.conversationId,
        signal: payload.signal,
      });
    }
    return;
  }

  // message: each device gets only its own envelope.
  let deliveredOnce = false;
  for (const conn of set) {
    const env = payload.envelopes.find((e) => e.recipientDeviceId === conn.deviceId);
    if (!env) continue;
    send(conn.socket, {
      type: 'message',
      message: {
        id: payload.messageId,
        conversationId: payload.conversationId,
        senderUserId: payload.senderUserId,
        senderDeviceId: payload.senderDeviceId,
        createdAt: payload.createdAt,
        envelope: { x3dh: env.x3dh, header: env.header, ciphertext: env.ciphertext },
      },
    });
    // Mark this device's envelope delivered (best-effort).
    void prisma.messageEnvelope
      .updateMany({
        where: { messageId: payload.messageId, recipientDeviceId: conn.deviceId, deliveredAt: null },
        data: { deliveredAt: new Date() },
      })
      .catch(() => {});
    deliveredOnce = true;
  }

  // Notify the sender that the message reached the recipient (once per delivery).
  if (deliveredOnce && payload.senderUserId !== userId) {
    await publishToUser(payload.senderUserId, {
      kind: 'receipt',
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      fromUserId: userId,
      state: 'DELIVERED',
    });
  }
}

/** Handle an event the client sent us over its socket. */
async function handleClientEvent(conn: Conn, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = wsClientEventSchema.safeParse(parsed);
  if (!result.success) return;
  const event = result.data;

  void refreshOnline(conn.userId);

  if (event.type === 'ping') {
    send(conn.socket, { type: 'pong' });
    return;
  }

  if (event.type === 'typing') {
    const peers = await otherMemberUserIds(event.conversationId, conn.userId);
    await Promise.all(
      peers.map((uid) =>
        publishToUser(uid, {
          kind: 'typing',
          conversationId: event.conversationId,
          fromUserId: conn.userId,
          isTyping: event.isTyping,
        }),
      ),
    );
    return;
  }

  if (event.type === 'read') {
    // Record READ receipt + advance the read pointer, then notify other members.
    await prisma.$transaction([
      prisma.messageReceipt.upsert({
        where: {
          messageId_userId_state: {
            messageId: event.messageId,
            userId: conn.userId,
            state: 'READ',
          },
        },
        create: { messageId: event.messageId, userId: conn.userId, state: 'READ' },
        update: { at: new Date() },
      }),
      prisma.conversationMember.updateMany({
        where: { conversationId: event.conversationId, userId: conn.userId },
        data: { lastReadMessageId: event.messageId },
      }),
    ]);
    const peers = await otherMemberUserIds(event.conversationId, conn.userId);
    await Promise.all(
      peers.map((uid) =>
        publishToUser(uid, {
          kind: 'receipt',
          conversationId: event.conversationId,
          messageId: event.messageId,
          fromUserId: conn.userId,
          state: 'READ',
        }),
      ),
    );
    return;
  }

  if (event.type === 'call') {
    // Relay WebRTC signaling to the target user (must share this conversation).
    if (!(await isMember(event.conversationId, event.toUserId))) return;
    await publishToUser(event.toUserId, {
      kind: 'call',
      fromUserId: conn.userId,
      conversationId: event.conversationId,
      signal: event.signal,
    });
  }
}

let subscriberWired = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;

export async function registerRealtime(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  // Keep the online-TTL of every locally-connected user fresh, independent of
  // whether the client happens to send frames (a passive socket is still online).
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const userId of local.keys()) void refreshOnline(userId);
    }, 25_000);
    app.addHook('onClose', async () => clearInterval(heartbeat));
  }

  // One shared Redis subscriber message handler for the whole instance.
  if (!subscriberWired) {
    subscriberWired = true;
    redisSub.on('message', (channel, message) => {
      if (channel === PRESENCE_CHANNEL) {
        const ev = JSON.parse(message) as { userId: string; online: boolean; lastSeenAt: string };
        for (const set of local.values()) {
          for (const conn of set) {
            send(conn.socket, {
              type: 'presence',
              userId: ev.userId,
              online: ev.online,
              lastSeenAt: ev.lastSeenAt,
            });
          }
        }
        return;
      }
      // user:<id> channel — the suffix is the recipient user id.
      const userId = channel.slice('user:'.length);
      void deliverToUser(userId, JSON.parse(message) as Fanout);
    });
    void redisSub.subscribe(PRESENCE_CHANNEL);
  }

  app.get('/ws', { websocket: true }, async (socket, request) => {
    // Authenticate via ?token= (browsers can't set WS Authorization headers).
    const token = (request.query as { token?: string })?.token;
    let userId: string;
    let deviceId: string;
    try {
      const claims = verifyAccessToken(token ?? '');
      userId = claims.sub;
      deviceId = claims.did;
    } catch {
      socket.close(1008, 'unauthorized');
      return;
    }

    const conn: Conn = { userId, deviceId, socket };
    addLocal(conn);
    await markOnline(userId);
    await publishPresence(userId, true, new Date().toISOString());

    // Tell the client which of its conversation peers are currently online.
    const peers = await prisma.conversationMember.findMany({
      where: { conversation: { members: { some: { userId } } }, userId: { not: userId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const onlineUserIds = await onlineFrom(peers.map((p) => p.userId));
    send(socket, { type: 'ready', onlineUserIds });

    socket.on('message', (data: Buffer) => void handleClientEvent(conn, data.toString()));

    socket.on('close', () => {
      removeLocal(conn);
      // If the user has no more local connections, mark offline & broadcast.
      if (!local.has(userId)) {
        void (async () => {
          await markOffline(userId);
          await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
          await publishPresence(userId, false, new Date().toISOString());
        })();
      }
    });
  });
}
