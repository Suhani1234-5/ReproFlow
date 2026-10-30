import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    // The 3D scene is a dynamic import, so three and the R3F runtime stay out of the entry chunk.
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three/') || id.includes('node_modules/@react-three/')) {
            return 'scene3d';
          }
          // React must not land inside scene3d: the entry imports React, so whatever chunk holds it
          // becomes a static import of the entry and its modulepreload is fetched on first paint.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
