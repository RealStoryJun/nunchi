/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F5F2EA',
        card: '#FFFFFF',
        ink: '#1A1A1A',
        sub: '#767270',
        border: '#E5DFD3',
        accent: '#1B4332',
        warm: '#E76F51',
        success: '#2D6A4F',
        warn: '#C99D52',
      },
      fontFamily: {
        display: ['"Gowun Batang"', 'serif'],
        sans: ['"Pretendard Variable"', 'Pretendard', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
