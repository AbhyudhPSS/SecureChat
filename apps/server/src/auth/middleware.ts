import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

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
  try {
    const claims = verifyAccessToken(header.slice('Bearer '.length));
    request.auth = { userId: claims.sub, deviceId: claims.did };
  } catch {
    return reply.code(401).send({ error: 'invalid_token' });
  }
}
