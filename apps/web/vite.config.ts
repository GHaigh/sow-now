import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // selfDestroying: generates a sw.js that immediately unregisters itself
      // and clears all caches. This kills any stale SW already installed on
      // clients that causes "text/html MIME type" errors when old hashed
      // asset filenames are requested after a redeploy.
      // Re-enable a proper SW config once the app is stable.
      selfDestroying: true,
      registerType: 'prompt',
      manifest: {
        name: 'Sow Now — Precision Growing',
        short_name: 'Sow Now',
        description: 'Your growing season, precisely. Local sensor data + GDD science = daily growing advice.',
        theme_color: '#166534',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://api.sow-now.uk',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
