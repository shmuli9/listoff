<script lang="ts">
  import { store } from '../lib/store.svelte';
  let u = $state(store.user || ''), p = $state(''), err = $state(''), busy = $state(false);
  async function submit(e: Event) {
    e.preventDefault();
    err = ''; busy = true;
    try { await store.login(u.trim(), p); }
    catch (ex: any) { err = ex.message === 'invalid credentials' ? 'Wrong username or password' : ex.message; busy = false; }
  }
</script>

<main class="login">
  <h1>listoff</h1>
  <p class="sub">{store.expired ? 'Your session ended. Sign in again; nothing you changed is lost.' : 'Shared shopping lists'}</p>
  <form onsubmit={submit}>
    <label for="u">Username</label>
    <input id="u" bind:value={u} autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <label for="p">Password</label>
    <input id="p" type="password" bind:value={p} autocomplete="current-password" required>
    <button class="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    {#if err}<p class="error" role="alert">{err}</p>{/if}
  </form>
</main>
