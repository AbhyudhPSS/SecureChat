import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';
import { prisma } from '../db.js';

/**
 * Authenticated request context. Populated by `authenticate` and read by
 * protected route handlers via `request.auth`.
 */
export interface AuthContext {
  userId: string;
  deviceId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * preHandler that requires a valid Bearer access token. On success attaches
 * `request.auth`; on failure replies 401 and stops the chain.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  let claims: { sub: string; did: string };
  try {
    claims = verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    return reply.code(401).send({ error: 'invalid_token' });
  }

  // The access token is stateless (≤15 min TTL), so also confirm the device hasn't
  // been revoked since the token was minted. This makes "revoke this device" take
  // effect immediately rather than lingering until the token expires. One indexed
  // PK lookup — negligible next to each route's own queries.
  const device = await prisma.device.findUnique({
    where: { id: claims.did },
    select: { revokedAt: true, userId: true },
  });
  if (!device || device.revokedAt || device.userId !== claims.sub) {
    return reply.code(401).send({ error: 'session_revoked' });
  }

  request.auth = { userId: claims.sub, deviceId: claims.did };
}
