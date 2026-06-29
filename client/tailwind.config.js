/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0E11',
        surface: '#161A1E',
        card: '#1E2328',
        border: '#2A2E35',
        'text-primary': '#EAECEF',
        'text-secondary': '#848E9C',
        up: '#0ECB81',
        down: '#F6465D',
        accent: '#1E88E5',
        warn: '#F0B90B',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'Fira Mono', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'price-lg': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }],
        'price-sm': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '-0.005em', fontVariantNumeric: 'tabular-nums' }],
      },
      boxShadow: {
        panel: '0 2px 12px 0 rgba(0,0,0,0.45), 0 1px 3px 0 rgba(0,0,0,0.3)',
        dropdown: '0 8px 32px 0 rgba(0,0,0,0.6), 0 2px 8px 0 rgba(0,0,0,0.4)',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '14px',
      },
      animation: {
        'flash-green': 'flashGreen 300ms ease-out',
        'flash-red': 'flashRed 300ms ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-down': 'slideDown 150ms ease-out',
        'fade-in': 'fadeIn 200ms ease-out',
      },
      keyframes: {
        flashGreen: {
          '0%': { backgroundColor: 'rgba(14, 203, 129, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashRed: {
          '0%': { backgroundColor: 'rgba(246, 70, 93, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 4px currentColor' },
          '50%': { opacity: '0.5', boxShadow: 'none' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)', opacity: 0 },
          to: { transform: 'translateX(0)', opacity: 1 },
        },
        slideDown: {
          from: { transform: 'translateY(-8px)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      },
      spacing: {
        '0.5': '2px',
        '1.5': '6px',
        '2.5': '10px',
        '3.5': '14px',
        '13': '52px',
        '18': '72px',
        '72': '288px',
        '80': '320px',
        '96': '384px',
      },
    },
  },
  plugins: [],
};
