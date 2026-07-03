import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { sendMessageSchema, type Envelope } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';
import { isMember } from '../conversations/service.js';
import { publishToUser } from '../realtime/bus.js';
import { MAX_BLOB_BYTES, objectSize } from '../storage.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /**
   * POST /messages — store per-recipient-device ciphertext envelopes and fan them
   * out in real time. The server never sees plaintext: it only routes opaque
   * envelopes keyed by recipient device.
   */
  app.post('/messages', async (request, reply) => {
    const parse = sendMessageSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    const me = request.auth!.userId;
    const { conversationId, senderDeviceId, envelopes, attachments } = parse.data;

    // The sending device must be the authenticated device, and a member.
    if (senderDeviceId !== request.auth!.deviceId) {
      return reply.code(403).send({ error: 'device_mismatch' });
    }
    if (!(await isMember(conversationId, me))) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    // Recipients must all be devices of CURRENT conversation members — prevents
    // leaking ciphertext to non-members (important for groups).
    const deviceIds = envelopes.map((e) => e.recipientDeviceId);
    const recipientDevices = await prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, userId: true },
    });
    const deviceToUser = new Map(recipientDevices.map((d) => [d.id, d.userId]));
    const memberRows = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    const memberSet = new Set(memberRows.map((m) => m.userId));
    for (const e of envelopes) {
      const uid = deviceToUser.get(e.recipientDeviceId);
      if (!uid || !memberSet.has(uid)) {
        return reply.code(400).send({ error: 'recipient_not_member' });
      }
    }

    // Attachments must reference blob keys THIS user was actually issued (prevents
    // attaching another user's blob or an arbitrary object), and the real stored
    // object must be within the size ceiling (presigned PUT can't cap size itself).
    if (attachments && attachments.length > 0) {
      const keys = attachments.map((a) => a.blobKey);
      const issued = await prisma.pendingUpload.findMany({
        where: { blobKey: { in: keys }, userId: me },
        select: { blobKey: true },
      });
      const issuedSet = new Set(issued.map((p) => p.blobKey));
      for (const a of attachments) {
        if (!issuedSet.has(a.blobKey)) return reply.code(400).send({ error: 'unknown_attachment' });
      }
      for (const a of attachments) {
        const size = await objectSize(a.blobKey);
        if (size === null) return reply.code(400).send({ error: 'attachment_missing' });
        if (size > MAX_BLOB_BYTES) return reply.code(413).send({ error: 'attachment_too_large' });
      }
    }

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: { conversationId, senderUserId: me, senderDeviceId },
      });
      await tx.messageEnvelope.createMany({
        data: envelopes.map((e) => ({
          messageId: msg.id,
          recipientDeviceId: e.recipientDeviceId,
          header: e.header as unknown as Prisma.InputJsonValue,
          x3dh: e.x3dh ? (e.x3dh as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          ciphertext: e.ciphertext,
        })),
      });
      if (attachments && attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((a) => ({
            messageId: msg.id,
            blobKey: a.blobKey,
            byteSize: a.byteSize,
          })),
        });
        // Consume the issued-key records — they've now become real attachments.
        await tx.pendingUpload.deleteMany({
          where: { blobKey: { in: attachments.map((a) => a.blobKey) } },
        });
      }
      return msg;
    });

    const createdAt = message.createdAt.toISOString();

    // Group envelopes by recipient user (deviceToUser computed above), then fan out.
    const byUser = new Map<string, Envelope[]>();
    for (const e of envelopes) {
      const uid = deviceToUser.get(e.recipientDeviceId);
      if (!uid) continue; // unknown device id — skip
      const list = byUser.get(uid) ?? [];
      list.push(e);
      byUser.set(uid, list);
    }

    await Promise.all(
      [...byUser.entries()].map(([userId, userEnvelopes]) =>
        publishToUser(userId, {
          kind: 'message',
          conversationId,
          messageId: message.id,
          senderUserId: me,
          senderDeviceId,
          createdAt,
          envelopes: userEnvelopes,
        }),
      ),
    );

    return reply.code(201).send({ messageId: message.id, createdAt });
  });
}
