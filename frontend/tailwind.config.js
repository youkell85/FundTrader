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
        bg: {
          DEFAULT: '#0D1117',
          card: '#161B22',
          hover: '#1C2333',
          input: '#21262D',
        },
        text: {
          primary: '#E6EDF3',
          secondary: '#8B949E',
          muted: '#484F58',
        },
        rise: '#EF4444',
        fall: '#22C55E',
        warn: '#F59E0B',
        info: '#6366F1',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
