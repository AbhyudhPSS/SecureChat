import type { FastifyInstance } from 'fastify';
import type { DeviceBundle, UserKeyBundles } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /**
   * GET /keys/:userId/bundle
   * Returns one prekey bundle per device of the target user, CONSUMING one
   * one-time prekey per device (deleted so it is never reused). X3DH still works
   * if a device has run out of one-time prekeys (falls back to 3-DH).
   */
  app.get<{ Params: { userId: string } }>('/keys/:userId/bundle', async (request, reply) => {
    const { userId } = request.params;
    const devices = await prisma.device.findMany({
      where: { userId, revokedAt: null },
      include: { signedPreKeys: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (devices.length === 0) {
      return reply.code(404).send({ error: 'no_devices' });
    }

    const bundles: DeviceBundle[] = [];
    for (const device of devices) {
      const spk = device.signedPreKeys[0];
      if (!spk) continue; // a device with no signed prekey can't be messaged yet

      // Atomically claim-and-delete one one-time prekey.
      const otk = await prisma.$transaction(async (tx) => {
        const k = await tx.oneTimePreKey.findFirst({
          where: { deviceId: device.id },
          orderBy: { keyId: 'asc' },
        });
        if (k) await tx.oneTimePreKey.delete({ where: { id: k.id } });
        return k;
      });

      bundles.push({
        deviceId: device.id,
        registrationId: device.registrationId,
        signingPublicKey: device.signingPublicKey,
        identityPublicKey: device.identityPublicKey,
        signedPreKey: { keyId: spk.keyId, publicKey: spk.publicKey, signature: spk.signature },
        oneTimePreKey: otk ? { keyId: otk.keyId, publicKey: otk.publicKey } : undefined,
      });
    }

    const result: UserKeyBundles = { userId, devices: bundles };
    return reply.send(result);
  });

  /**
   * GET /keys/:userId/identity
   * Public identity keys per device — does NOT consume a one-time prekey. Used for
   * safety-number computation / verification without burning prekeys.
   */
  app.get<{ Params: { userId: string } }>('/keys/:userId/identity', async (request, reply) => {
    const devices = await prisma.device.findMany({
      where: { userId: request.params.userId, revokedAt: null },
      select: { id: true, signingPublicKey: true, identityPublicKey: true },
    });
    return reply.send({
      userId: request.params.userId,
      devices: devices.map((d) => ({
        deviceId: d.id,
        signingPublicKey: d.signingPublicKey,
        identityPublicKey: d.identityPublicKey,
      })),
    });
  });
}
