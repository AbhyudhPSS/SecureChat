import jwt from 'jsonwebtoken';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';

/**
 * Token strategy:
 *   - Short-lived JWT ACCESS token (stateless, carried in Authorization header).
 *   - Long-lived opaque REFRESH token, stored only as a SHA-256 hash, rotated on
 *     every use. Reuse of a rotated token is treated as theft and revokes the
 *     whole rotation "family" (see auth route).
 */

export interface AccessClaims {
  sub: string; // userId
  did: string; // deviceId
}

const JWT_ISSUER = 'securechat';
const JWT_AUDIENCE = 'securechat-api';

export function signAccessToken(userId: string, deviceId: string): string {
  return jwt.sign({ did: deviceId } satisfies Omit<AccessClaims, 'sub'>, config.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: config.JWT_ACCESS_TTL,
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.did !== 'string') {
    throw new Error('malformed access token');
  }
  return { sub: decoded.sub, did: decoded.did };
}

export interface NewRefreshToken {
  token: string; // returned to the client (set as httpOnly cookie)
  tokenHash: string; // stored in DB
  family: string;
  expiresAt: Date;
}

export function createRefreshToken(family: string = randomUUID()): NewRefreshToken {
  const token = randomBytes(48).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    family,
    expiresAt: new Date(Date.now() + config.JWT_REFRESH_TTL * 1000),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
