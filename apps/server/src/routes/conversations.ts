import type { FastifyInstance } from 'fastify';
import {
  addMembersSchema,
  createConversationSchema,
  createGroupSchema,
  setRoleSchema,
  type ConversationDetail,
  type ConversationSummary,
  type MemberRole,
  type MessageItem,
  type PublicUser,
} from '@securechat/types';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';
import { ensureDirectConversation, isMember } from '../conversations/service.js';

/** Require the caller to be an OWNER/ADMIN of the conversation. */
async function requireAdmin(conversationId: string, userId: string): Promise<boolean> {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { role: true },
  });
  return m?.role === 'OWNER' || m?.role === 'ADMIN';
}

/**
 * Member add / role changes are GROUP-only. Without this a member could inject a
 * third participant into a DIRECT (1:1) conversation, silently turning a private
 * DM into a multi-party room whose new member becomes a valid ciphertext recipient.
 */
async function isGroup(conversationId: string): Promise<boolean> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true },
  });
  return c?.type === 'GROUP';
}

function toPublicUser(u: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** POST /conversations — open (or reuse) a DIRECT conversation with a user. */
  app.post('/conversations', async (request, reply) => {
    const parse = createConversationSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    const me = request.auth!.userId;
    const { peerUserId } = parse.data;
    if (peerUserId === me) return reply.code(400).send({ error: 'cannot_message_self' });

    const peer = await prisma.user.findUnique({ where: { id: peerUserId } });
    if (!peer) return reply.code(404).send({ error: 'user_not_found' });

    const id = await ensureDirectConversation(me, peerUserId);
    const summary: ConversationSummary = {
      id,
      type: 'DIRECT',
      title: null,
      peer: toPublicUser(peer),
      memberCount: 2,
      lastMessageAt: null,
      unread: 0,
    };
    return reply.code(201).send(summary);
  });

  /** POST /conversations/group — create a GROUP; creator becomes OWNER. */
  app.post('/conversations/group', async (request, reply) => {
    const parse = createGroupSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    const me = request.auth!.userId;
    const { title, memberUserIds } = parse.data;
    // Unique member set including the creator.
    const memberIds = [...new Set([me, ...memberUserIds])];

    const found = await prisma.user.count({ where: { id: { in: memberIds } } });
    if (found !== memberIds.length) return reply.code(400).send({ error: 'unknown_member' });

    const convo = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        title,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === me ? 'OWNER' : 'MEMBER',
          })),
        },
      },
    });
    const summary: ConversationSummary = {
      id: convo.id,
      type: 'GROUP',
      title,
      peer: null,
      memberCount: memberIds.length,
      lastMessageAt: null,
      unread: 0,
    };
    return reply.code(201).send(summary);
  });

  /** GET /conversations/:id — full detail incl. members + roles (members only). */
  app.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const me = request.auth!.userId;
    const { id } = request.params;
    if (!(await isMember(id, me))) return reply.code(403).send({ error: 'forbidden' });
    const convo = await prisma.conversation.findUnique({
      where: { id },
      include: { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!convo) return reply.code(404).send({ error: 'not_found' });
    const detail: ConversationDetail = {
      id: convo.id,
      type: convo.type,
      title: convo.title,
      members: convo.members.map((m) => ({
        user: toPublicUser(m.user),
        role: m.role as MemberRole,
      })),
    };
    return reply.send(detail);
  });

  /** POST /conversations/:id/members — add members (admins/owner only). */
  app.post<{ Params: { id: string } }>('/conversations/:id/members', async (request, reply) => {
    const me = request.auth!.userId;
    const { id } = request.params;
    const parse = addMembersSchema.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await isGroup(id))) return reply.code(400).send({ error: 'not_a_group' });
    if (!(await requireAdmin(id, me))) return reply.code(403).send({ error: 'forbidden' });

    await prisma.conversationMember.createMany({
      data: parse.data.userIds.map((userId) => ({ conversationId: id, userId, role: 'MEMBER' as const })),
      skipDuplicates: true,
    });
    return reply.send({ ok: true });
  });

  /** DELETE /conversations/:id/members/:userId — remove a member, or leave (self). */
  app.delete<{ Params: { id: string; userId: string } }>(
    '/conversations/:id/members/:userId',
    async (request, reply) => {
      const me = request.auth!.userId;
      const { id, userId } = request.params;
      const isSelf = userId === me;
      if (!isSelf && !(await requireAdmin(id, me))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await prisma.conversationMember.deleteMany({ where: { conversationId: id, userId } });
      return reply.send({ ok: true });
    },
  );

  /** PATCH /conversations/:id/members/:userId — promote/demote (owner/admin). */
  app.patch<{ Params: { id: string; userId: string } }>(
    '/conversations/:id/members/:userId',
    async (request, reply) => {
      const me = request.auth!.userId;
      const { id, userId } = request.params;
      const parse = setRoleSchema.safeParse(request.body);
      if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
      if (!(await isGroup(id))) return reply.code(400).send({ error: 'not_a_group' });
      if (!(await requireAdmin(id, me))) return reply.code(403).send({ error: 'forbidden' });
      try {
        await prisma.conversationMember.update({
          where: { conversationId_userId: { conversationId: id, userId } },
          data: { role: parse.data.role },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_a_member' });
        }
        throw err;
      }
      return reply.send({ ok: true });
    },
  );

  /** GET /conversations — my conversations with peer, last activity, unread count. */
  app.get('/conversations', async (request) => {
    const me = request.auth!.userId;
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: me },
      include: {
        conversation: {
          include: {
            members: { include: { user: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const summaries: ConversationSummary[] = [];
    for (const m of memberships) {
      const convo = m.conversation;
      const peerMember = convo.members.find((x) => x.userId !== me);
      const last = convo.messages[0];

      // Unread = messages from others created after my read pointer.
      let lastReadAt = new Date(0);
      if (m.lastReadMessageId) {
        const lastRead = await prisma.message.findUnique({
          where: { id: m.lastReadMessageId },
          select: { createdAt: true },
        });
        if (lastRead) lastReadAt = lastRead.createdAt;
      }
      const unread = await prisma.message.count({
        where: {
          conversationId: convo.id,
          senderUserId: { not: me },
          createdAt: { gt: lastReadAt },
        },
      });

      summaries.push({
        id: convo.id,
        type: convo.type,
        title: convo.title,
        peer: convo.type === 'DIRECT' && peerMember ? toPublicUser(peerMember.user) : null,
        memberCount: convo.members.length,
        lastMessageAt: last ? last.createdAt.toISOString() : null,
        unread,
      });
    }

    // Most recent activity first.
    summaries.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
    return summaries;
  });

  /**
   * GET /conversations/:id/messages — history addressed to MY device, keyset
   * paginated by createdAt (`before` ISO timestamp), returned oldest→newest.
   */
  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    '/conversations/:id/messages',
    async (request, reply) => {
      const me = request.auth!.userId;
      const myDevice = request.auth!.deviceId;
      const { id } = request.params;
      if (!(await isMember(id, me))) return reply.code(403).send({ error: 'forbidden' });

      const limit = Math.min(Number(request.query.limit) || 50, 100);
      const before = request.query.before ? new Date(request.query.before) : undefined;

      const rows = await prisma.message.findMany({
        where: {
          conversationId: id,
          deletedAt: null,
          ...(before ? { createdAt: { lt: before } } : {}),
          envelopes: { some: { recipientDeviceId: myDevice } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { envelopes: { where: { recipientDeviceId: myDevice }, take: 1 } },
      });

      const items: MessageItem[] = rows
        .map((m): MessageItem | null => {
          const env = m.envelopes[0];
          if (!env) return null;
          const envelope: MessageItem['envelope'] = {
            header: env.header as MessageItem['envelope']['header'],
            ciphertext: env.ciphertext,
          };
          const x3dh = env.x3dh as MessageItem['envelope']['x3dh'];
          if (x3dh) envelope.x3dh = x3dh;
          return {
            id: m.id,
            conversationId: m.conversationId,
            senderUserId: m.senderUserId,
            senderDeviceId: m.senderDeviceId,
            createdAt: m.createdAt.toISOString(),
            envelope,
          };
        })
        .filter((x): x is MessageItem => x !== null)
        .reverse(); // oldest → newest

      return reply.send(items);
    },
  );
}
