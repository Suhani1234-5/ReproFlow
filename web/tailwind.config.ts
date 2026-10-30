import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Black canvas, white and blue-grey dots, one cyan accent used sparingly.
        mist: {
          100: '#f5f7fa',
          300: '#c3cbd9',
          500: '#8892a6',
          // 4.84:1 on black: the old #5b6474 was 3.52:1 and failed AA for small text.
          // mist-700 is only ever used for small labels, so it has to clear 4.5:1.
          700: '#6f7a8d',
          900: '#232936',
        },
        accent: {
          DEFAULT: '#22d3ee',
          soft: '#67e8f9',
          deep: '#0e7490',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      maxWidth: { content: '76rem' },
    },
  },
  plugins: [],
} satisfies Config;
