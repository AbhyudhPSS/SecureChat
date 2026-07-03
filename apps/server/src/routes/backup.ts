import type { FastifyInstance } from 'fastify';
import { backupUploadSchema, type BackupInfo } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';

/**
 * Encrypted chat backup. The blob is wrapped client-side with a user-chosen
 * passphrase (Argon2id) and is OPAQUE to the server. One backup per user.
 */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** PUT /backup — store/replace the encrypted backup blob. */
  app.put('/backup', async (request, reply) => {
    const parse = backupUploadSchema.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const userId = request.auth!.userId;
    await prisma.backup.upsert({
      where: { userId },
      create: { userId, blob: parse.data.blob },
      update: { blob: parse.data.blob },
    });
    return reply.send({ ok: true });
  });

  /** GET /backup/info — whether a backup exists + its size/time (no blob). */
  app.get('/backup/info', async (request, reply) => {
    const b = await prisma.backup.findUnique({ where: { userId: request.auth!.userId } });
    const info: BackupInfo = {
      exists: !!b,
      updatedAt: b ? b.updatedAt.toISOString() : null,
      size: b ? b.blob.length : 0,
    };
    return reply.send(info);
  });

  /** GET /backup — fetch the encrypted backup blob (to restore on this device). */
  app.get('/backup', async (request, reply) => {
    const b = await prisma.backup.findUnique({ where: { userId: request.auth!.userId } });
    if (!b) return reply.code(404).send({ error: 'no_backup' });
    return reply.send({ blob: b.blob, updatedAt: b.updatedAt.toISOString() });
  });

  /** DELETE /backup — remove the stored backup. */
  app.delete('/backup', async (request, reply) => {
    await prisma.backup.deleteMany({ where: { userId: request.auth!.userId } });
    return reply.send({ ok: true });
  });
}
