import { fileURLToPath } from 'node:url';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as ManifestV3Export })],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  build: { target: 'chrome116' },
});
