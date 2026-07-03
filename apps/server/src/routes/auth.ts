import type { FastifyInstance, FastifyReply } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { loginSchema, registerSchema, type AuthResult, type PublicUser } from '@securechat/types';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config, isProd } from '../config.js';
import {
  RefreshError,
  issueSession,
  revokeFamily,
  rotateRefresh,
  upsertDevice,
} from '../auth/service.js';
import { hashRefreshToken } from '../auth/tokens.js';

// Argon2id parameters (OWASP-recommended baseline). Tune with load testing.
const ARGON2_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const REFRESH_COOKIE = 'sc_refresh';

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/auth',
    maxAge: config.JWT_REFRESH_TTL,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
}

function toPublicUser(u: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

// Tight rate limits on credential endpoints to slow stuffing/brute-force.
// Relaxed ONLY under the automated test runner; dev and prod are both protected
// (a dev instance can be exposed, and normal use never hits these low ceilings).
const strictLimit = (max: number) => ({
  config: {
    rateLimit: { max: config.NODE_ENV === 'test' ? 100_000 : max, timeWindow: '1 minute' },
  },
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Real Argon2 hash used to keep login timing uniform for unknown usernames.
  const dummyHash = await hash('sc-timing-uniform-dummy-password', ARGON2_OPTS);

  /**
   * POST /auth/register — create account + first device atomically. The server
   * only ever sees PUBLIC key material; the password is Argon2id-hashed.
   */
  app.post('/auth/register', strictLimit(5), async (request, reply) => {
    const parse = registerSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    const { username, displayName, password, device } = parse.data;
    const passwordHash = await hash(password, ARGON2_OPTS);

    try {
      const { user, deviceId } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { username, displayName, passwordHash } });
        const deviceId = await upsertDevice(tx, user.id, device);
        return { user, deviceId };
      });

      const { accessToken, refresh } = await issueSession(user.id, deviceId);
      setRefreshCookie(reply, refresh.token);
      request.log.info({ event: 'auth.register', userId: user.id, deviceId }, 'account created');
      const result: AuthResult = { user: toPublicUser(user), deviceId, accessToken };
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'username_taken' });
      }
      request.log.error({ err }, 'register failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  /**
   * POST /auth/login — verify password, upsert the presenting device + its
   * prekeys, and issue a session. Uses a constant-ish path to avoid leaking
   * whether the username exists.
   */
  app.post('/auth/login', strictLimit(10), async (request, reply) => {
    const parse = loginSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    }
    const { username, password, device } = parse.data;

    const user = await prisma.user.findUnique({ where: { username } });
    // Always run a real verify (against a dummy hash for unknown users) so login
    // timing does not reveal whether the username exists.
    const ok = await verify(user?.passwordHash ?? dummyHash, password).catch(() => false);

    if (!user || !ok) {
      request.log.warn({ event: 'auth.login_failed', ip: request.ip }, 'invalid credentials');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const deviceId = await prisma.$transaction((tx) => upsertDevice(tx, user.id, device));
    const { accessToken, refresh } = await issueSession(user.id, deviceId);
    setRefreshCookie(reply, refresh.token);
    request.log.info({ event: 'auth.login', userId: user.id, deviceId }, 'login ok');
    const result: AuthResult = { user: toPublicUser(user), deviceId, accessToken };
    return reply.send(result);
  });

  /**
   * POST /auth/refresh — rotate the refresh cookie and mint a new access token.
   * Reuse of a rotated token revokes the whole family (theft detection).
   */
  app.post('/auth/refresh', strictLimit(60), async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) return reply.code(401).send({ error: 'no_refresh_token' });

    try {
      const rotated = await rotateRefresh(token);
      setRefreshCookie(reply, rotated.refresh.token);
      const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
      if (!user) return reply.code(401).send({ error: 'unauthorized' });
      const result: AuthResult = {
        user: toPublicUser(user),
        deviceId: rotated.deviceId,
        accessToken: rotated.accessToken,
      };
      return reply.send(result);
    } catch (err) {
      if (err instanceof RefreshError) {
        // Reuse of a rotated token → likely stolen; the whole family was burned.
        // This is a real attack signal, so log it at WARN for monitoring/alerting.
        request.log.warn(
          { event: 'auth.refresh_rejected', reason: err.message, ip: request.ip },
          'refresh token rejected (possible theft)',
        );
        clearRefreshCookie(reply);
        return reply.code(401).send({ error: 'refresh_rejected' });
      }
      request.log.error({ err }, 'refresh failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  /** POST /auth/logout — revoke the current refresh family and clear the cookie. */
  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      const existing = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(token) },
      });
      if (existing) await revokeFamily(existing.family);
    }
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });
}
