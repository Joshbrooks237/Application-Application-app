/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2557a7',
          light: '#3b82f6',
          dark: '#1a3f7a',
        },
        surface: {
          DEFAULT: '#0f172a',
          raised: '#1e293b',
          overlay: '#334155',
        },
        accent: '#a78bfa',
        success: '#22c55e',
        warning: '#eab308',
        danger: '#ef4444',
        'keyword-highlight': '#fde047',
      },
      animation: {
        fadeInUp: 'fadeInUp 0.4s ease-out both',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
