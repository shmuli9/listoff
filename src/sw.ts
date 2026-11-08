/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// The hashed app shell is served cache-first, so launch never waits on the network.
// API traffic is cross-origin and not handled here; list data is cached by the app per user and wiped on sign-out.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('listoff-shell-')).map((k) => caches.delete(k))); // v1 caches
    await self.clients.claim();
  })());
});
