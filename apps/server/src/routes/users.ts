import type { FastifyInstance } from 'fastify';
import { updateProfileSchema, type Me, type PublicUser } from '@securechat/types';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { authenticate } from '../auth/middleware.js';
import { onlineFrom } from '../redis.js';
import { presignDownload } from '../storage.js';

function toMe(u: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
}): Me {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // All routes here require authentication.
  app.addHook('preHandler', authenticate);

  app.get('/users/me', async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return reply.send(toMe(user));
  });

  /** GET /users/search?q= — find users by username prefix/substring (excludes self). */
  app.get<{ Querystring: { q?: string } }>('/users/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return reply.send([]);
    const users = await prisma.user.findMany({
      where: {
        username: { contains: q.toLowerCase(), mode: 'insensitive' },
        id: { not: request.auth!.userId },
      },
      take: 20,
      orderBy: { username: 'asc' },
    });
    const result: PublicUser[] = users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
    }));
    return reply.send(result);
  });

  /** GET /presence?ids=a,b,c — which of these users are currently online. */
  app.get<{ Querystring: { ids?: string } }>('/presence', async (request, reply) => {
    const ids = (request.query.ids ?? '').split(',').filter(Boolean).slice(0, 200);
    return reply.send({ onlineUserIds: await onlineFrom(ids) });
  });

  app.patch('/users/me', async (request, reply) => {
    const parse = updateProfileSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    try {
      const user = await prisma.user.update({
        where: { id: request.auth!.userId },
        data: { ...parse.data, username: parse.data.username?.toLowerCase() },
      });
      return reply.send(toMe(user));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }
  });

  /**
   * GET /users/:id/avatar — short-lived presigned URL for a user's avatar image.
   * Avatars are profile-public (any authenticated user can view), consistent with
   * usernames being discoverable. Returns `{ url: null }` if none is set.
   */
  app.get<{ Params: { id: string } }>('/users/:id/avatar', async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: { avatarUrl: true },
    });
    if (!user?.avatarUrl) return reply.send({ url: null });
    return reply.send({ url: await presignDownload(user.avatarUrl) });
  });
}
