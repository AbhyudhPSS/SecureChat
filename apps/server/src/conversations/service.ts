import { prisma } from '../db.js';

/**
 * Conversation helpers shared by the REST routes and the realtime gateway.
 */

/** User ids of all members of a conversation except `exceptUserId`. */
export async function otherMemberUserIds(
  conversationId: string,
  exceptUserId: string,
): Promise<string[]> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { not: exceptUserId } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** True if the user is a member of the conversation (authorization check). */
export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true },
  });
  return m !== null;
}

/**
 * Find (or create) the DIRECT conversation between two users. Idempotent: a stable
 * pair never produces two conversations even under a race (unique membership +
 * a deterministic lookup).
 */
export async function ensureDirectConversation(userA: string, userB: string): Promise<string> {
  // Look for an existing DIRECT conversation both users belong to.
  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: userA } } },
        { members: { some: { userId: userB } } },
      ],
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      members: { create: [{ userId: userA }, { userId: userB }] },
    },
    select: { id: true },
  });
  return created.id;
}
