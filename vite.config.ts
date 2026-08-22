import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // A custom service worker (src/sw.ts) instead of the auto-generated
      // one — needed for the push/notificationclick listeners that make
      // task notifications show up at the OS/device level, not just as an
      // in-app bell badge. Precaching and the Supabase API runtime cache
      // are set up by hand inside src/sw.ts using the same Workbox
      // primitives generateSW used to configure declaratively here.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      manifest: {
        name: 'Smart Forester | Palamau Tiger Reserve',
        short_name: 'Smart Forester',
        description: 'Task management for Palamau Tiger Reserve field operations',
        theme_color: '#1A4731',
        background_color: '#F5F1E8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
