import type { FastifyInstance } from 'fastify';
import type { DeviceInfo } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** GET /devices — list this user's active (non-revoked) devices. */
  app.get('/devices', async (request, reply) => {
    const devices = await prisma.device.findMany({
      where: { userId: request.auth!.userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const result: DeviceInfo[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      registrationId: d.registrationId,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      current: d.id === request.auth!.deviceId,
    }));
    return reply.send(result);
  });

  /**
   * DELETE /devices/:id — revoke a device. Soft-revokes (so message attribution
   * survives), deletes its prekeys (no new sessions can target it), and revokes
   * its refresh tokens (it can no longer renew access).
   */
  app.delete<{ Params: { id: string } }>('/devices/:id', async (request, reply) => {
    const { id } = request.params;
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || device.userId !== request.auth!.userId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    await prisma.$transaction([
      prisma.device.update({ where: { id }, data: { revokedAt: new Date() } }),
      prisma.signedPreKey.deleteMany({ where: { deviceId: id } }),
      prisma.oneTimePreKey.deleteMany({ where: { deviceId: id } }),
      prisma.refreshToken.updateMany({
        where: { deviceId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.send({ ok: true });
  });
}
