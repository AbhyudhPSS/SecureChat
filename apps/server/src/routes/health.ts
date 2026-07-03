import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: process is up. Never touches the DB.
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Readiness: dependencies reachable. Used by orchestrators before routing traffic.
  app.get('/health/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'up' };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });
}
