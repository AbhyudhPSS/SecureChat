import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isProd } from './config.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { keyRoutes } from './routes/keys.js';
import { conversationRoutes } from './routes/conversations.js';
import { messageRoutes } from './routes/messages.js';
import { attachmentRoutes } from './routes/attachments.js';
import { deviceRoutes } from './routes/devices.js';
import { sealedRoutes } from './routes/sealed.js';
import { backupRoutes } from './routes/backup.js';
import { registerRealtime } from './realtime/gateway.js';
import { incr, renderMetrics } from './metrics.js';
import { randomUUID } from 'node:crypto';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? true
      : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } },
    // Trust the reverse proxy in production for correct client IPs / rate limiting.
    trustProxy: isProd,
    bodyLimit: 5 * 1024 * 1024, // 5 MB — large attachments go via presigned object storage
    genReqId: () => randomUUID(),
  });

  // Surface the request id (for tracing / log correlation) and count requests.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (_req, reply) => {
    incr('securechat_http_requests_total');
    if (reply.statusCode >= 500) incr('securechat_http_5xx_total');
  });

  // Security headers (CSP/HSTS/etc). API serves JSON only, so a strict default is fine.
  await app.register(helmet, { contentSecurityPolicy: isProd });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true, // allow the httpOnly refresh cookie
  });
  await app.register(cookie);

  // Baseline abuse protection. NOTE: the default store is per-instance memory;
  // for multi-instance production, back this with the Redis store.
  await app.register(rateLimit, {
    max: isProd ? 100 : 100_000, // strict in prod; generous in dev/test
    timeWindow: '1 minute',
  });

  // Realtime gateway (WebSocket) — registered before routes that publish to it.
  await registerRealtime(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(keyRoutes);
  await app.register(conversationRoutes);
  await app.register(messageRoutes);
  await app.register(attachmentRoutes);
  await app.register(deviceRoutes);
  await app.register(sealedRoutes);
  await app.register(backupRoutes);

  // Prometheus scrape endpoint (no auth; expose only on the internal network in prod).
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return renderMetrics();
  });

  return app;
}
