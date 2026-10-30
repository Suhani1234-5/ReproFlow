import { fileURLToPath } from 'node:url';

// The repo root has no Vite app: this file exists so `vitest run` from the root still resolves the extension's @shared alias.
export default {
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['extension/src/**/*.test.ts'],
  },
};
