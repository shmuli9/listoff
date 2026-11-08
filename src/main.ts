import '@fontsource-variable/fraunces/wght.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });

// Keep sheets above the on-screen keyboard (iOS doesn't resize the layout viewport for it).
const vv = window.visualViewport;
if (vv) {
  const update = () => document.documentElement.style.setProperty('--kb', Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px');
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  // Apply updates while the app is backgrounded, never under the user's thumb.
  let hadController = !!navigator.serviceWorker.controller;
  let updateReady = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    updateReady = true;
    if (document.hidden) location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (updateReady && document.hidden) location.reload(); });
}
