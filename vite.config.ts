import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './', // works on GitHub Pages' /listoff/ and on localhost
  plugins: [
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}', 'icons/apple-touch-icon.png', 'icons/icon-192.png'],
        globIgnores: ['**/*vietnamese*', '**/*latin-ext*', 'splash/**'],
      },
    }),
  ],
  build: { target: 'es2022', cssMinify: true },
  test: { include: ['tests/**/*.test.ts'] },
});
