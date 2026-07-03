import type {
  AuthResult,
  BackupInfo,
  ConversationDetail,
  ConversationSummary,
  DeviceInfo,
  MemberRole,
  LoginInput,
  Me,
  MessageItem,
  PreKeyBundleUpload,
  PresignUploadResult,
  PublicUser,
  RegisterInput,
  SendMessageInput,
  UpdateProfileInput,
  UserKeyBundles,
} from '@securechat/types';

interface IdentityResult {
  userId: string;
  devices: { deviceId: string; signingPublicKey: string; identityPublicKey: string }[];
}

/**
 * Typed API client.
 *
 * The access token is kept ONLY in memory (never localStorage) to reduce XSS
 * exposure; it is lost on reload and silently re-minted via the httpOnly refresh
 * cookie. On a 401, one transparent refresh+retry is attempted.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;
export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};
export const getAccessToken = (): string | null => accessToken;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

async function raw(path: string, init: RequestInit, retry = true): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await silentRefresh();
    if (refreshed) return raw(path, init, false);
  }
  return res;
}

async function json<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const res = await raw(path, init, retry);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? 'request_failed', body.details);
  }
  return body as T;
}

/**
 * Attempt to mint a new access token from the refresh cookie.
 *
 * Single-flighted: concurrent callers (e.g. React StrictMode's double-invoked
 * effect, or several requests hitting 401 at once) share ONE in-flight refresh.
 * Without this, two parallel refreshes present the same single-use token and the
 * second trips the server's token-reuse/theft detection, revoking the session.
 */
let refreshInFlight: Promise<AuthResult | null> | null = null;

export function silentRefresh(): Promise<AuthResult | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const result = (await res.json()) as AuthResult;
      setAccessToken(result.accessToken);
      return result;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const api = {
  register(input: RegisterInput): Promise<AuthResult> {
    return json('/auth/register', { method: 'POST', body: JSON.stringify(input) });
  },
  login(input: LoginInput): Promise<AuthResult> {
    return json('/auth/login', { method: 'POST', body: JSON.stringify(input) });
  },
  async logout(): Promise<void> {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    setAccessToken(null);
  },
  me(): Promise<Me> {
    return json('/users/me', { method: 'GET' });
  },
  updateProfile(input: UpdateProfileInput): Promise<Me> {
    return json('/users/me', { method: 'PATCH', body: JSON.stringify(input) });
  },
  userAvatar(userId: string): Promise<{ url: string | null }> {
    return json(`/users/${userId}/avatar`, { method: 'GET' });
  },
  searchUsers(q: string): Promise<PublicUser[]> {
    return json(`/users/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
  },
  presence(userIds: string[]): Promise<{ onlineUserIds: string[] }> {
    return json(`/presence?ids=${encodeURIComponent(userIds.join(','))}`, { method: 'GET' });
  },
  keyBundle(userId: string): Promise<UserKeyBundles> {
    return json(`/keys/${userId}/bundle`, { method: 'GET' });
  },
  listConversations(): Promise<ConversationSummary[]> {
    return json('/conversations', { method: 'GET' });
  },
  createConversation(peerUserId: string): Promise<ConversationSummary> {
    return json('/conversations', { method: 'POST', body: JSON.stringify({ peerUserId }) });
  },
  createGroup(title: string, memberUserIds: string[]): Promise<ConversationSummary> {
    return json('/conversations/group', {
      method: 'POST',
      body: JSON.stringify({ title, memberUserIds }),
    });
  },
  conversationDetail(id: string): Promise<ConversationDetail> {
    return json(`/conversations/${id}`, { method: 'GET' });
  },
  addMembers(id: string, userIds: string[]): Promise<{ ok: boolean }> {
    return json(`/conversations/${id}/members`, { method: 'POST', body: JSON.stringify({ userIds }) });
  },
  removeMember(id: string, userId: string): Promise<{ ok: boolean }> {
    return json(`/conversations/${id}/members/${userId}`, { method: 'DELETE' });
  },
  setMemberRole(id: string, userId: string, role: MemberRole): Promise<{ ok: boolean }> {
    return json(`/conversations/${id}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },
  history(conversationId: string): Promise<MessageItem[]> {
    return json(`/conversations/${conversationId}/messages`, { method: 'GET' });
  },
  sendMessage(input: SendMessageInput): Promise<{ messageId: string; createdAt: string }> {
    return json('/messages', { method: 'POST', body: JSON.stringify(input) });
  },
  presignUpload(): Promise<PresignUploadResult> {
    return json('/attachments/presign-upload', { method: 'POST', body: '{}' });
  },
  attachmentDownload(blobKey: string): Promise<{ downloadUrl: string }> {
    return json(`/attachments/download?blobKey=${encodeURIComponent(blobKey)}`, { method: 'GET' });
  },
  identity(userId: string): Promise<IdentityResult> {
    return json(`/keys/${userId}/identity`, { method: 'GET' });
  },
  devices(): Promise<DeviceInfo[]> {
    return json('/devices', { method: 'GET' });
  },
  revokeDevice(id: string): Promise<{ ok: boolean }> {
    return json(`/devices/${id}`, { method: 'DELETE' });
  },
  uploadBackup(blob: string): Promise<{ ok: boolean }> {
    return json('/backup', { method: 'PUT', body: JSON.stringify({ blob }) });
  },
  backupInfo(): Promise<BackupInfo> {
    return json('/backup/info', { method: 'GET' });
  },
  downloadBackup(): Promise<{ blob: string; updatedAt: string }> {
    return json('/backup', { method: 'GET' });
  },
  deleteBackup(): Promise<{ ok: boolean }> {
    return json('/backup', { method: 'DELETE' });
  },
};

export type { PreKeyBundleUpload };
