import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Obsidian" — deep navy/charcoal base for the glass to float on.
        obsidian: {
          950: '#05060b',
          900: '#080a12',
          850: '#0b0e1a',
          800: '#10131f',
          700: '#171b2b',
          600: '#1f2438',
          500: '#2a3050',
        },
        // `ink` aliases keep existing class names working, mapped onto the new palette.
        ink: {
          900: '#080a12',
          800: '#10131f',
          700: '#171b2b',
          600: '#1f2438',
          500: '#2a3050',
        },
        // Accent ramps are CSS-variable-backed so the active theme (index.css
        // `[data-theme]`) can recolor every accent without touching components.
        brand: {
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
        },
        violet: {
          400: 'rgb(var(--violet-400) / <alpha-value>)',
          500: 'rgb(var(--violet-500) / <alpha-value>)',
          600: 'rgb(var(--violet-600) / <alpha-value>)',
        },
        accent: {
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // Soft depth + a faint inner top highlight that sells the "glass".
        glass: '0 16px 50px -12px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(255,255,255,0.06)',
        'glass-sm': '0 8px 24px -10px rgba(0,0,0,0.5), inset 0 1px 0 0 rgba(255,255,255,0.05)',
        glow: '0 0 30px -6px rgb(var(--brand-500) / 0.5)',
        'glow-strong': '0 0 50px -8px rgb(var(--brand-500) / 0.65)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'msg-in-left': {
          '0%': { opacity: '0', transform: 'translateY(8px) translateX(-6px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) translateX(0) scale(1)' },
        },
        'msg-in-right': {
          '0%': { opacity: '0', transform: 'translateY(8px) translateX(6px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) translateX(0) scale(1)' },
        },
        'glow-pulse': {
          '0%,100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'ring-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'msg-in-left': 'msg-in-left 0.32s cubic-bezier(0.22,1,0.36,1) both',
        'msg-in-right': 'msg-in-right 0.32s cubic-bezier(0.22,1,0.36,1) both',
        'glow-pulse': 'glow-pulse 2.4s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'ring-ping': 'ring-ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
