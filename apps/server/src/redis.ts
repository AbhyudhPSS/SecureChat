import Redis from 'ioredis';
import { config } from './config.js';

/**
 * Redis powers two things that must work across multiple stateless app instances:
 *   1. Pub/sub fan-out of realtime events (a message accepted by instance A must
 *      reach a recipient connected to instance B).
 *   2. Presence (which users are currently online), with TTL'd heartbeats.
 *
 * A dedicated subscriber connection is required because a connection in
 * subscribe mode cannot issue normal commands.
 */
export const redisPub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
export const redisSub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
export const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

export async function connectRedis(): Promise<void> {
  await Promise.all([redisPub.connect(), redisSub.connect(), redis.connect()]);
}

export async function disconnectRedis(): Promise<void> {
  redisPub.disconnect();
  redisSub.disconnect();
  redis.disconnect();
}

/** Channel a user's realtime events are published on. */
export const userChannel = (userId: string): string => `user:${userId}`;
/** Global channel for presence changes (every instance forwards to its sockets). */
export const PRESENCE_CHANNEL = 'presence';

// ── Presence (online set with TTL heartbeats) ──────────────────────────────────
const PRESENCE_TTL_SECONDS = 60;
const presenceKey = (userId: string): string => `online:${userId}`;

export async function markOnline(userId: string): Promise<void> {
  await redis.set(presenceKey(userId), '1', 'EX', PRESENCE_TTL_SECONDS);
}

export async function refreshOnline(userId: string): Promise<void> {
  await redis.expire(presenceKey(userId), PRESENCE_TTL_SECONDS);
}

export async function markOffline(userId: string): Promise<void> {
  await redis.del(presenceKey(userId));
}

export async function isOnline(userId: string): Promise<boolean> {
  return (await redis.exists(presenceKey(userId))) === 1;
}

export async function onlineFrom(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.exists(presenceKey(id));
  const results = await pipeline.exec();
  const online: string[] = [];
  results?.forEach(([, exists], i) => {
    if (exists === 1) online.push(userIds[i]!);
  });
  return online;
}
