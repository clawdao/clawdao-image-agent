/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'clawdao-purple': '#764ba2',
        'clawdao-blue': '#667eea',
        'clawdao-gold': '#FFD700',
        'clawdao-dark-gold': '#B8860B',
      },
    },
  },
  plugins: [],
};
