import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PreKeyBundleUpload } from '@securechat/types';
import { prisma } from '../db.js';
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  type NewRefreshToken,
} from './tokens.js';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Create or refresh a device and its prekeys for a user. Used by both register
 * and login so the prekey-publishing logic lives in exactly one place. Returns
 * the device id.
 */
export async function upsertDevice(
  tx: Tx,
  userId: string,
  device: PreKeyBundleUpload,
): Promise<string> {
  const record = await tx.device.upsert({
    where: { userId_registrationId: { userId, registrationId: device.registrationId } },
    create: {
      userId,
      name: device.deviceName,
      registrationId: device.registrationId,
      signingPublicKey: device.signingPublicKey,
      identityPublicKey: device.identityPublicKey,
      deliveryToken: randomBytes(24).toString('base64url'), // for sealed-sender delivery
    },
    // NOTE: identity/signing public keys are deliberately NOT updated for an
    // existing device. They are immutable for the life of a (userId, registrationId)
    // device — a genuine key rotation means a reinstall, which generates a fresh
    // random registrationId and therefore a new device row. Allowing overwrite here
    // would let a password-only login silently swap a user's identity key, enabling
    // a server-assisted MITM that safety numbers wouldn't flag until re-verified.
    update: {
      name: device.deviceName,
      lastSeenAt: new Date(),
    },
  });

  // Refresh the signed prekey (idempotent on keyId).
  await tx.signedPreKey.upsert({
    where: { deviceId_keyId: { deviceId: record.id, keyId: device.signedPreKey.keyId } },
    create: {
      deviceId: record.id,
      keyId: device.signedPreKey.keyId,
      publicKey: device.signedPreKey.publicKey,
      signature: device.signedPreKey.signature,
    },
    update: {
      publicKey: device.signedPreKey.publicKey,
      signature: device.signedPreKey.signature,
    },
  });

  // Replenish one-time prekeys, ignoring any keyIds already stored.
  if (device.oneTimePreKeys.length > 0) {
    await tx.oneTimePreKey.createMany({
      data: device.oneTimePreKeys.map((k) => ({
        deviceId: record.id,
        keyId: k.keyId,
        publicKey: k.publicKey,
      })),
      skipDuplicates: true,
    });
  }

  return record.id;
}

export interface IssuedSession {
  accessToken: string;
  refresh: NewRefreshToken;
}

/** Mint an access token and persist a fresh refresh token (optionally in a family). */
export async function issueSession(
  userId: string,
  deviceId: string,
  family?: string,
): Promise<IssuedSession> {
  const refresh = createRefreshToken(family);
  await prisma.refreshToken.create({
    data: {
      userId,
      deviceId,
      tokenHash: refresh.tokenHash,
      family: refresh.family,
      expiresAt: refresh.expiresAt,
    },
  });
  return { accessToken: signAccessToken(userId, deviceId), refresh };
}

export class RefreshError extends Error {}

export interface RotatedSession extends IssuedSession {
  userId: string;
  deviceId: string;
}

/**
 * Rotate a refresh token. Each token is single-use:
 *   - unknown / expired  → reject.
 *   - already rotated (revokedAt set) → REUSE DETECTED: revoke the whole family
 *     (an attacker replayed a stolen-but-already-used token) and reject.
 *   - valid → mark it revoked, issue a new token in the same family.
 */
export async function rotateRefresh(plainToken: string): Promise<RotatedSession> {
  const tokenHash = hashRefreshToken(plainToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) throw new RefreshError('unknown refresh token');

  if (existing.revokedAt || existing.expiresAt < new Date()) {
    // Reuse of a rotated/expired token → assume theft, burn the family.
    await revokeFamily(existing.family);
    throw new RefreshError('refresh token reuse detected');
  }

  const rotated = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const refresh = createRefreshToken(existing.family);
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        deviceId: existing.deviceId,
        tokenHash: refresh.tokenHash,
        family: refresh.family,
        expiresAt: refresh.expiresAt,
      },
    });
    return refresh;
  });

  return {
    userId: existing.userId,
    deviceId: existing.deviceId ?? '',
    accessToken: signAccessToken(existing.userId, existing.deviceId ?? ''),
    refresh: rotated,
  };
}

/** Revoke every (non-revoked) token in a rotation family — used on logout & theft. */
export async function revokeFamily(family: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
