<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { applyTheme, theme, type Theme } from '../lib/ui.svelte';
  import TopBar from './TopBar.svelte';

  let cur = $state(''), next = $state(''), err = $state(''), busy = $state(false), confirmOut = $state(false);
  const themes: Theme[] = ['system', 'light', 'dark'];

  async function change(e: Event) {
    e.preventDefault();
    err = ''; busy = true;
    try { await store.changePassword(cur, next); } catch (ex: any) { err = ex.message; busy = false; }
  }
  function signOut() {
    if (store.dirtyCount && !confirmOut) { confirmOut = true; return; }
    store.logout();
  }
</script>

<TopBar title="Account" back="#/" />
<main class="page">
  <p class="muted">Signed in as <b>{store.user}</b></p>

  <section>
    <h3 class="cat-head">Appearance</h3>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each themes as t}
        <button role="radio" aria-checked={theme.value === t} class:on={theme.value === t} onclick={() => applyTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
      {/each}
    </div>
  </section>

  <section>
    <h3 class="cat-head">Change password</h3>
    <form onsubmit={change}>
      <label for="cur">Current password</label>
      <input id="cur" type="password" bind:value={cur} autocomplete="current-password" required>
      <label for="nxt">New password (8+ characters)</label>
      <input id="nxt" type="password" bind:value={next} autocomplete="new-password" minlength="8" required>
      <button class="primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
      {#if err}<p class="error" role="alert">{err}</p>{/if}
    </form>
  </section>

  <section>
    <button class="ghost danger" onclick={signOut}>{confirmOut ? 'Unsynced changes will be lost. Tap again' : 'Sign out'}</button>
  </section>
</main>
