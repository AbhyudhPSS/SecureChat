import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * User avatar: shows the profile image if set (resolved from the stored blob key to
 * a short-lived presigned URL, cached per user for the session), otherwise a
 * gradient with initials. Groups (no avatarUrl) fall back to initials too.
 */

// userId -> resolved presigned URL (per session). Keyed by user so a changed avatar
// can be invalidated via clearAvatarCache.
const urlCache = new Map<string, string>();
export function clearAvatarCache(userId: string): void {
  urlCache.delete(userId);
}

export function Avatar({
  userId,
  name,
  avatarUrl,
  size = 40,
  gradient,
  className = '',
}: {
  userId?: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  gradient?: boolean; // force the gradient look (e.g. groups)
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(() => (userId ? (urlCache.get(userId) ?? null) : null));

  useEffect(() => {
    if (!userId || !avatarUrl) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(userId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    api
      .userAvatar(userId)
      .then((r) => {
        if (alive && r.url) {
          urlCache.set(userId, r.url);
          setUrl(r.url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, avatarUrl]);

  const dims = { width: size, height: size, fontSize: size * 0.4 };

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={dims}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <div
      style={dims}
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${
        gradient ? 'bg-gradient-to-br from-brand-500 to-accent-500' : 'bg-white/[0.06]'
      } ${className}`}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
