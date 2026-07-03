import { useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Lightweight, dependency-free emoji picker. A curated set grouped by category —
 * enough for everyday chat without pulling in a multi-megabyte emoji library.
 */
const CATEGORIES: { label: string; icon: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    icon: '😀',
    emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤔 🤨 😐 😑 😶 🙄 😏 😣 😴 😪 😌 😛 🤤 😎 🥳 🥺 😢 😭 😤 😠 😡 🤬 😱 😨 😰 😥 😓 🤯 😳 🥵 🥶 😬 🙁 😖 😞 😟'.split(
      ' ',
    ),
  },
  {
    label: 'Gestures',
    icon: '👍',
    emojis: '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤲 🙏 🤝 💪 👋 🤙 👆 👇 👈 👉 ✊ 👊 🫶 🫡 🫥 💅 🦾'.split(
      ' ',
    ),
  },
  {
    label: 'Hearts',
    icon: '❤️',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ 🔥 💯 🎉 🎊 ⭐ 🌟'.split(
      ' ',
    ),
  },
  {
    label: 'Animals',
    icon: '🐶',
    emojis: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦄 🐝 🦋 🐢 🐙 🦕 🐳 🐬 🦈'.split(
      ' ',
    ),
  },
  {
    label: 'Food',
    icon: '🍕',
    emojis: '🍏 🍎 🍌 🍉 🍇 🍓 🍑 🍍 🥑 🍔 🍟 🍕 🌭 🌮 🌯 🍜 🍣 🍦 🍩 🍪 🎂 🍰 ☕ 🍵 🍺 🍷 🥂'.split(
      ' ',
    ),
  },
  {
    label: 'Travel',
    icon: '✈️',
    emojis: '🚗 🚕 🚙 🏎️ 🚓 🚑 🚒 🚲 🛵 🏍️ ✈️ 🚀 🛸 🚁 ⛵ 🚤 🏝️ 🏔️ 🌋 🗼 🗽 🎡 🎢 🏟️ 🌍 🌙'.split(
      ' ',
    ),
  },
  {
    label: 'Objects',
    icon: '🔒',
    emojis: '🔒 🔑 🔐 🛡️ 💻 📱 ⌚ 📷 🎧 🎮 💡 🔋 📎 ✏️ 📌 📚 💰 🎁 🔔 ⏰ 🧩 🏆 🎯 ⚙️ 📡 🔓'.split(
      ' ',
    ),
  },
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [cat, setCat] = useState(0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className="glass absolute bottom-full left-0 z-20 mb-3 w-72 rounded-2xl p-2 shadow-glow"
    >
      <div className="mb-1 flex gap-1 border-b border-white/10 pb-1">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.label}
            title={c.label}
            onClick={() => setCat(i)}
            className={`grid h-8 w-8 place-items-center rounded-lg text-base transition ${
              cat === i ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="scroll-thin grid max-h-48 grid-cols-7 gap-0.5 overflow-y-auto p-1">
        {CATEGORIES[cat]!.emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => onSelect(e)}
            className="grid h-8 w-8 place-items-center rounded-lg text-xl transition hover:bg-white/10"
          >
            {e}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
