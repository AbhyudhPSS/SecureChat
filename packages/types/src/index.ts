import { z } from 'zod';

/**
 * Shared DTO schemas used by both the server (request validation) and the web
 * client (typed API calls). Keeping them in one package guarantees the wire
 * contract cannot drift between front and back end.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_.]+$/, 'lowercase letters, numbers, underscore and dot only');

export const passwordSchema = z.string().min(12).max(256);

/** A device's public key bundle, uploaded at registration / key rotation. */
export const preKeyBundleSchema = z.object({
  registrationId: z.number().int().nonnegative(),
  deviceName: z.string().min(1).max(64),
  signingPublicKey: z.string(),
  identityPublicKey: z.string(),
  signedPreKey: z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string(),
    signature: z.string(),
  }),
  oneTimePreKeys: z
    .array(z.object({ keyId: z.number().int().nonnegative(), publicKey: z.string() }))
    .max(200),
});
export type PreKeyBundleUpload = z.infer<typeof preKeyBundleSchema>;

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1).max(64),
  password: passwordSchema,
  device: preKeyBundleSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  // The client presents its current device bundle on login. The server upserts
  // the device by (userId, registrationId) and refreshes its prekeys, so the
  // same flow works for a returning device and a brand-new one (multi-device).
  device: preKeyBundleSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Full profile of the authenticated user (GET /users/me). */
export const meSchema = publicUserSchema.extend({
  bio: z.string().nullable(),
  createdAt: z.string(),
});
export type Me = z.infer<typeof meSchema>;

export const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  displayName: z.string().min(1).max(64).optional(),
  bio: z.string().max(280).nullable().optional(),
  avatarUrl: z.string().max(256).nullable().optional(), // object-storage blob key for the avatar
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Standard auth success payload returned by register / login / refresh. */
export interface AuthResult {
  user: PublicUser;
  deviceId: string;
  accessToken: string;
}

// ── Messaging ─────────────────────────────────────────────────────────────────

// ── Key bundles (fetched to start a session) ───────────────────────────────────

/** One device's public bundle, with a single one-time prekey consumed for us. */
export interface DeviceBundle {
  deviceId: string;
  registrationId: number;
  signingPublicKey: string;
  identityPublicKey: string;
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  oneTimePreKey?: { keyId: number; publicKey: string };
}

/** All of a user's device bundles, returned by GET /keys/:userId/bundle. */
export interface UserKeyBundles {
  userId: string;
  devices: DeviceBundle[];
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export const ratchetHeaderSchema = z.object({
  dh: z.string(),
  pn: z.number().int().nonnegative(),
  n: z.number().int().nonnegative(),
});

/** X3DH initial message, attached to the FIRST envelope of a new session. */
export const x3dhInitSchema = z.object({
  initiatorIdentityKey: z.string(),
  initiatorEphemeralKey: z.string(),
  signedPreKeyId: z.number().int().nonnegative(),
  oneTimePreKeyId: z.number().int().nonnegative().optional(),
});
export type X3dhInit = z.infer<typeof x3dhInitSchema>;

/** One recipient device's ciphertext for a single logical message. */
export const envelopeSchema = z.object({
  recipientDeviceId: z.string(),
  x3dh: x3dhInitSchema.optional(), // present only on the first message of a session
  header: ratchetHeaderSchema,
  ciphertext: z.string(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

/** Reference to an already-uploaded encrypted blob (metadata only; key is in the body). */
export const attachmentRefSchema = z.object({
  blobKey: z.string().max(256),
  byteSize: z.number().int().nonnegative().max(50 * 1024 * 1024), // 50 MB cap
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const sendMessageSchema = z.object({
  conversationId: z.string(),
  senderDeviceId: z.string(),
  clientId: z.string().max(64).optional(), // client-generated id for idempotent retries
  envelopes: z.array(envelopeSchema).min(1).max(100),
  attachments: z.array(attachmentRefSchema).max(10).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export interface PresignUploadResult {
  blobKey: string;
  uploadUrl: string;
}

// ── Sealed sender (metadata-minimizing transport) ───────────────────────────────

export const sealedSendSchema = z.object({
  recipientDeviceId: z.string(),
  deliveryToken: z.string().max(256), // recipient's opaque token (no sender auth)
  sealed: z.string().max(64_000), // crypto_box_seal blob (base64)
});
export type SealedSendInput = z.infer<typeof sealedSendSchema>;

export interface SealedInboxItem {
  id: string;
  sealed: string;
  createdAt: string;
}

// ── Encrypted chat backup ───────────────────────────────────────────────────────

export const backupUploadSchema = z.object({
  blob: z.string().max(50_000_000), // passphrase-encrypted backup (base64); opaque to server
});
export type BackupUploadInput = z.infer<typeof backupUploadSchema>;

export interface BackupInfo {
  exists: boolean;
  updatedAt: string | null;
  size: number;
}

// ── Devices (multi-device management) ───────────────────────────────────────────

export interface DeviceInfo {
  id: string;
  name: string;
  registrationId: number;
  createdAt: string;
  lastSeenAt: string;
  current: boolean; // is this the device making the request
}

// ── Conversations ───────────────────────────────────────────────────────────────

export const createConversationSchema = z.object({
  peerUserId: z.string(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const createGroupSchema = z.object({
  title: z.string().min(1).max(80),
  memberUserIds: z.array(z.string()).min(1).max(256),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const addMembersSchema = z.object({
  userIds: z.array(z.string()).min(1).max(256),
});

export const setRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export interface ConversationSummary {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null; // group title (groups only)
  peer: PublicUser | null; // the other participant in a DIRECT conversation
  memberCount: number;
  lastMessageAt: string | null;
  unread: number;
}

export interface GroupMember {
  user: PublicUser;
  role: MemberRole;
}

export interface ConversationDetail {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null;
  members: GroupMember[];
}

/** A message as delivered to ONE device (its own ciphertext envelope). */
export interface MessageItem {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  createdAt: string;
  envelope: { x3dh?: X3dhInit; header: z.infer<typeof ratchetHeaderSchema>; ciphertext: string };
}

// ── Realtime (WebSocket) protocol ──────────────────────────────────────────────

export const callSignalSchema = z.object({
  callId: z.string().max(64),
  // offer/answer/ice/end/reject/busy = pairwise WebRTC; invite/join/present/leave
  // = group-call mesh coordination (ring everyone, then form a full mesh).
  kind: z.enum([
    'invite',
    'join',
    'present',
    'leave',
    'offer',
    'answer',
    'ice',
    'end',
    'reject',
    'busy',
  ]),
  media: z.enum(['audio', 'video']).optional(),
  isGroup: z.boolean().optional(),
  sdp: z.string().max(200_000).optional(), // session description (offer/answer)
  candidate: z.unknown().optional(), // RTCIceCandidateInit
  fromDeviceId: z.string().optional(),
});
export type CallSignal = z.infer<typeof callSignalSchema>;

export const wsClientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('typing'), conversationId: z.string(), isTyping: z.boolean() }),
  z.object({ type: z.literal('read'), conversationId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal('ping') }),
  // WebRTC call signaling, targeted at a specific peer user.
  z.object({
    type: z.literal('call'),
    toUserId: z.string(),
    conversationId: z.string(),
    signal: callSignalSchema,
  }),
]);
export type WsClientEvent = z.infer<typeof wsClientEventSchema>;

export type WsServerEvent =
  | { type: 'message'; message: MessageItem }
  | { type: 'typing'; conversationId: string; userId: string; isTyping: boolean }
  | {
      type: 'receipt';
      conversationId: string;
      messageId: string;
      userId: string;
      state: 'DELIVERED' | 'READ';
    }
  | { type: 'presence'; userId: string; online: boolean; lastSeenAt: string }
  | { type: 'ready'; onlineUserIds: string[] }
  | { type: 'call'; fromUserId: string; conversationId: string; signal: CallSignal }
  | { type: 'pong' };
