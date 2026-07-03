import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sealedSendSchema, type SealedInboxItem } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function sealedRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /sealed — anonymous sealed-sender delivery.
   *
   * Deliberately NOT authenticated as the sender: the request is authorized by
   * the RECIPIENT's opaque delivery token (shared with contacts out-of-band over
   * the E2EE channel). The server therefore never learns who sent the message —
   * it only learns which device should receive an opaque blob.
   */
  app.post('/sealed', async (request, reply) => {
    const parse = sealedSendSchema.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const { recipientDeviceId, deliveryToken, sealed } = parse.data;

    const device = await prisma.device.findUnique({
      where: { id: recipientDeviceId },
      select: { id: true, deliveryToken: true, revokedAt: true },
    });
    if (!device || device.revokedAt || !safeEqual(device.deliveryToken, deliveryToken)) {
      return reply.code(403).send({ error: 'invalid_delivery_token' });
    }

    const msg = await prisma.sealedMessage.create({
      data: { recipientDeviceId, sealed },
    });
    return reply.code(201).send({ id: msg.id });
  });

  /** GET /sealed/inbox — undelivered sealed messages for the calling device. */
  app.get('/sealed/inbox', { preHandler: authenticate }, async (request, reply) => {
    const deviceId = request.auth!.deviceId;
    const rows = await prisma.sealedMessage.findMany({
      where: { recipientDeviceId: deviceId, deliveredAt: null },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    if (rows.length > 0) {
      await prisma.sealedMessage.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deliveredAt: new Date() },
      });
    }
    const items: SealedInboxItem[] = rows.map((r) => ({
      id: r.id,
      sealed: r.sealed,
      createdAt: r.createdAt.toISOString(),
    }));
    return reply.send(items);
  });

  /** GET /sealed/token — this device's delivery token (to share with contacts). */
  app.get('/sealed/token', { preHandler: authenticate }, async (request, reply) => {
    const device = await prisma.device.findUnique({
      where: { id: request.auth!.deviceId },
      select: { deliveryToken: true },
    });
    if (!device) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ deliveryToken: device.deliveryToken });
  });
}
