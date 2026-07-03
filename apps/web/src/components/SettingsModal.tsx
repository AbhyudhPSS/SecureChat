import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  User,
  Shield,
  Bell,
  Smartphone,
  Check,
  Loader2,
  Moon,
  KeyRound,
  Trash2,
  Archive,
  CloudUpload,
  Download,
  RotateCcw,
  Camera,
  Volume2,
  Palette,
} from 'lucide-react';
import type { BackupInfo, DeviceInfo } from '@securechat/types';
import { useSession } from '../store';
import { useSounds } from '../soundStore';
import { useTheme, THEMES, OPACITY_MIN, OPACITY_MAX } from '../themeStore';
import { useChat } from '../chatStore';
import { api, ApiError } from '../lib/api';
import { uploadAvatar } from '../lib/attachments';
import { Avatar, clearAvatarCache } from './Avatar';
import { backupToServer, buildBackup, downloadBackupFile, restoreFromServer, restoreFromString } from '../lib/backup';
import { loadConversations } from '../lib/messaging';

type Tab = 'profile' | 'appearance' | 'privacy' | 'security' | 'devices' | 'backup';

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'backup', label: 'Backup', icon: Archive },
];

export function SettingsModal() {
  const close = useSession((s) => s.closeSettings);
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={close}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex h-[560px] w-full max-w-3xl overflow-hidden rounded-2xl"
      >
        {/* Nav */}
        <div className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-white/[0.02] p-3">
          <h2 className="px-2 py-3 text-sm font-semibold">Settings</h2>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                tab === t.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="scroll-thin flex-1 overflow-y-auto p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-semibold capitalize">{tab}</h3>
            <button
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'backup' && <BackupTab />}
        </div>
      </motion.div>
    </motion.div>
  );
}

function AppearanceTab() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const glassOpacity = useTheme((s) => s.glassOpacity);
  const setGlassOpacity = useTheme((s) => s.setGlassOpacity);
  const pct = Math.round((glassOpacity / OPACITY_MAX) * 100);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Pick a background and a coordinated accent palette. Saved on this device.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => {
          const active = t.id === theme;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`group relative overflow-hidden rounded-2xl border p-3.5 text-left transition ${
                active
                  ? 'border-brand-400/70 shadow-glow ring-2 ring-brand-500/30'
                  : 'border-white/10 hover:border-white/25'
              }`}
              style={{
                backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}2e, ${t.swatch[1]}1f 55%, ${t.swatch[2]}14)`,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{t.label}</span>
                {active ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="h-5 w-5 rounded-full border border-white/20" />
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">{t.tagline}</p>
              <div className="mt-3 flex gap-1.5">
                {t.swatch.map((c, i) => (
                  <span
                    key={i}
                    className="h-5 w-5 rounded-full ring-1 ring-white/20"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
      {/* Glass opacity */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Panel opacity</span>
          <span className="text-xs tabular-nums text-slate-400">{pct}%</span>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          How much of the background shows through the frosted panels.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Clear</span>
          <input
            type="range"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            step={0.01}
            value={glassOpacity}
            onChange={(e) => setGlassOpacity(parseFloat(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-brand-500"
          />
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Solid</span>
        </div>
      </div>

      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
        Each theme uses a full-screen photo from <code className="text-slate-300">public/themes/</code>. Drop your own
        images named <code className="text-slate-300">emerald.jpg</code>, <code className="text-slate-300">glacier.jpg</code>,{' '}
        <code className="text-slate-300">carnival.jpg</code>, <code className="text-slate-300">onyx.jpg</code>,{' '}
        <code className="text-slate-300">crimson.jpg</code> to replace the built-in gradients.
      </p>
    </div>
  );
}

function ProfileTab() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .me()
      .then((me) => {
        setBio(me.bio ?? '');
        setAvatarUrl(me.avatarUrl);
      })
      .catch(() => {});
  }, []);

  const applyMe = (me: { id: string; username: string; displayName: string; avatarUrl: string | null }) => {
    setUser({ id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl });
  };

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setUploading(true);
    setError(null);
    try {
      const blobKey = await uploadAvatar(file);
      const me = await api.updateProfile({ avatarUrl: blobKey });
      clearAvatarCache(user.id);
      setAvatarUrl(me.avatarUrl);
      applyMe(me);
    } catch {
      setError('Could not upload avatar.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const me = await api.updateProfile({
        displayName,
        bio: bio || null,
        ...(username && username !== user?.username ? { username } : {}),
      });
      applyMe(me);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'username_taken' ? 'That username is taken.' : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="group relative shrink-0 rounded-full"
          title="Change avatar"
        >
          <Avatar userId={user?.id} name={displayName || 'You'} avatarUrl={avatarUrl} size={72} gradient />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          </span>
        </button>
        <div>
          <p className="text-sm font-medium">{displayName || 'You'}</p>
          <p className="text-xs text-slate-500">Tap your photo to change it.</p>
        </div>
      </div>

      <LabeledInput label="Display name" value={displayName} onChange={setDisplayName} />
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <p className="mt-1 text-xs text-slate-500">How others find you. 3–32 chars: a–z, 0–9, _ .</p>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          maxLength={280}
          placeholder="A short bio (optional)"
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
        {saved ? 'Saved' : 'Save changes'}
      </button>
    </div>
  );
}

function PrivacyTab() {
  const sounds = useSounds();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Toggle label="Read receipts" description="Let others know when you've read their messages." defaultOn />
        <Toggle label="Typing indicators" description="Show when you're typing." defaultOn />
        <Toggle label="Last seen & online" description="Share your online status and last-seen time." />
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <Volume2 className="h-3.5 w-3.5" /> Sounds
        </p>
        <div className="space-y-2">
          <BoundToggle label="Enable sounds" description="Master switch for all in-app sounds." value={sounds.enabled} onChange={(v) => sounds.set({ enabled: v })} />
          <BoundToggle label="Message chimes" description="Play a chime when you send or receive a message." value={sounds.messages} onChange={(v) => sounds.set({ messages: v })} disabled={!sounds.enabled} />
          <BoundToggle label="Call tones" description="Ringtone for incoming calls and ringback for outgoing." value={sounds.calls} onChange={(v) => sounds.set({ calls: v })} disabled={!sounds.enabled} />
          <BoundToggle label="Typing tick" description="A subtle tick while typing (off by default)." value={sounds.typing} onChange={(v) => sounds.set({ typing: v })} disabled={!sounds.enabled} />
        </div>
      </div>

      <p className="pt-1 text-xs text-slate-500">
        Read-receipt and presence toggles are UI placeholders in this build; sound settings are live
        and saved to this device.
      </p>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-brand-300">
          <Moon className="h-4 w-4" /> Theme
        </div>
        <p className="mt-1 text-xs text-slate-400">
          SecureChat is dark by default. Light theme arrives in a later pass.
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-brand-400" /> Encryption keys
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Your private keys are generated on this device and stored encrypted with your password
          (Argon2id). They never reach the server. Open a conversation's info panel to compare its
          safety number and verify there's no man-in-the-middle.
        </p>
      </div>
    </div>
  );
}

function DevicesTab() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = () => api.devices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    void load();
  }, []);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await api.revokeDevice(id);
      await load();
    } finally {
      setRevoking(null);
    }
  };

  if (!devices) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Each device holds its own encryption keys. Revoking a device stops it from
        receiving new messages and renewing its session.
      </p>
      {devices.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4"
        >
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-brand-400" />
            <div>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-slate-500">
                Added {new Date(d.createdAt).toLocaleDateString()} · last seen{' '}
                {new Date(d.lastSeenAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          {d.current ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              This device
            </span>
          ) : (
            <button
              onClick={() => revoke(d.id)}
              disabled={revoking === d.id}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
            >
              {revoking === d.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Revoke
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function BackupTab() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => api.backupInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (pass.length < 8) {
      setMsg({ ok: false, text: 'Use a backup passphrase of at least 8 characters.' });
      return;
    }
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && /padding|json/i.test(e.message) ? 'Wrong passphrase or corrupt backup.' : 'Operation failed.' });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const afterRestore = async () => {
    await loadConversations();
    useChat.getState().setActive(null);
  };

  const restoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('file-restore', async () => {
      const text = await file.text();
      const r = await restoreFromString(pass, text);
      await afterRestore();
      setMsg({ ok: true, text: `Restored ${r.messages} messages across ${r.conversations} chats.` });
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400">
        Your message history lives encrypted on this device. A backup wraps it (plus your keys and
        sessions) with a passphrase you choose — it's end-to-end encrypted, so the server can never
        read it. Keep the passphrase safe: without it the backup is unrecoverable.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
        {info?.exists
          ? `Server backup: ${(info.size / 1024).toFixed(0)} KB · updated ${new Date(info.updatedAt!).toLocaleString()}`
          : 'No server backup yet.'}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Backup passphrase</label>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <BackupButton
          icon={<CloudUpload className="h-4 w-4" />}
          label="Back up to server"
          busy={busy === 'upload'}
          onClick={() =>
            run('upload', async () => {
              await backupToServer(pass);
              setMsg({ ok: true, text: 'Backed up to the server (encrypted).' });
            })
          }
        />
        <BackupButton
          icon={<Download className="h-4 w-4" />}
          label="Download file"
          busy={busy === 'download'}
          onClick={() =>
            run('download', async () => {
              downloadBackupFile(await buildBackup(pass));
              setMsg({ ok: true, text: 'Encrypted backup file downloaded.' });
            })
          }
        />
        <BackupButton
          icon={<RotateCcw className="h-4 w-4" />}
          label="Restore from server"
          busy={busy === 'restore'}
          disabled={!info?.exists}
          onClick={() =>
            run('restore', async () => {
              const r = await restoreFromServer(pass);
              await afterRestore();
              setMsg({ ok: true, text: `Restored ${r.messages} messages across ${r.conversations} chats.` });
            })
          }
        />
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/[0.05]">
          {busy === 'file-restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
          Restore from file
          <input type="file" accept=".scbackup,application/json" className="hidden" onChange={restoreFile} />
        </label>
      </div>
    </div>
  );
}

function BackupButton({
  icon,
  label,
  onClick,
  busy,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/[0.05] disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      />
    </div>
  );
}

function Toggle({
  label,
  description,
  defaultOn,
}: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <Switch on={on} />
    </button>
  );
}

/** Controlled toggle bound to external state (e.g. sound settings). */
function BoundToggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05] disabled:opacity-40"
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <Switch on={value} />
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        on ? 'bg-gradient-to-r from-brand-500 to-violet-500 shadow-glow' : 'bg-white/10'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      />
    </span>
  );
}
