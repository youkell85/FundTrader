/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1A73E8',
          light: '#4A90E2',
          dark: '#0D5BBF',
        },
        gold: {
          DEFAULT: '#E8A735',
          light: '#F5C563',
          dark: '#C4891A',
        },
        cyan: {
          DEFAULT: '#00F0FF',
          light: '#7DF9FF',
          dark: '#00B8C4',
        },
        rose: {
          DEFAULT: '#FF3366',
          light: '#FF6B8A',
          dark: '#CC0044',
        },
        bg: {
          DEFAULT: '#0A0E17',
          card: '#0F1623',
          hover: '#151D2E',
          input: '#1A2236',
          elevated: '#1E293B',
        },
        text: {
          primary: '#F0F4F8',
          secondary: '#94A3B8',
          muted: '#475569',
          dim: '#334155',
        },
        rise: '#EF4444',
        fall: '#22C55E',
        warn: '#F59E0B',
        info: '#6366F1',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
      backdropBlur: {
        glass: '12px',
        heavy: '20px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
