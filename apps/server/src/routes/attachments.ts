import type { FastifyInstance } from 'fastify';
import type { PresignUploadResult } from '@securechat/types';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';
import { isMember } from '../conversations/service.js';
import { newBlobKey, presignDownload, presignUpload } from '../storage.js';

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /**
   * POST /attachments/presign-upload
   * Hand back an opaque blob key + a short-lived presigned PUT URL. The client
   * encrypts the file locally, then uploads the ciphertext directly to storage.
   */
  app.post('/attachments/presign-upload', async (_request, reply) => {
    const blobKey = newBlobKey();
    const uploadUrl = await presignUpload(blobKey);
    const result: PresignUploadResult = { blobKey, uploadUrl };
    return reply.send(result);
  });

  /**
   * GET /attachments/download?blobKey=…
   * Authorize (caller must be a member of the attachment's conversation), then
   * return a short-lived presigned GET URL for the ciphertext blob.
   */
  app.get<{ Querystring: { blobKey?: string } }>('/attachments/download', async (request, reply) => {
    const blobKey = request.query.blobKey;
    if (!blobKey) return reply.code(400).send({ error: 'missing_blob_key' });

    const attachment = await prisma.attachment.findUnique({
      where: { blobKey },
      include: { message: { select: { conversationId: true } } },
    });
    if (!attachment) return reply.code(404).send({ error: 'not_found' });
    if (!(await isMember(attachment.message.conversationId, request.auth!.userId))) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    return reply.send({ downloadUrl: await presignDownload(blobKey) });
  });
}
