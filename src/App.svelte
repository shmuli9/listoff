<script lang="ts">
  import { store } from './lib/store.svelte';
  import { router, toastState, hideToast } from './lib/ui.svelte';
  import Login from './components/Login.svelte';
  import Home from './components/Home.svelte';
  import ListView from './components/ListView.svelte';
  import Account from './components/Account.svelte';
</script>

{#if !store.token}
  <Login />
{:else if router.route.name === 'list'}
  {#key router.route.id}
    <ListView id={router.route.id!} tab={router.route.tab!} />
  {/key}
{:else if router.route.name === 'account'}
  <Account />
{:else}
  <Home />
{/if}

<div class="toast-wrap" aria-live="polite">
  {#if toastState.visible}
    {#key toastState.id}
      <div class="toast" role="status">
        <span>{toastState.msg}</span>
        {#if toastState.undo}
          <button onclick={() => { const u = toastState.undo; hideToast(); u?.(); }}>Undo</button>
        {/if}
      </div>
    {/key}
  {/if}
</div>
