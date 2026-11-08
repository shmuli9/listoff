// ---- toast ----
export const toastState = $state<{ id: number; msg: string; undo?: () => void; visible: boolean }>({ id: 0, msg: '', visible: false });
let timer: ReturnType<typeof setTimeout>;
export function toast(msg: string, undo?: () => void) {
  toastState.id++; toastState.msg = msg; toastState.undo = undo; toastState.visible = true;
  clearTimeout(timer);
  timer = setTimeout(hideToast, undo ? 6000 : 3000);
}
export function hideToast() { toastState.visible = false; }

// ---- motion / haptics ----
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} }; // Android only; iOS has no web vibration API

// ---- theme ----
export type Theme = 'system' | 'light' | 'dark';
export const theme = $state<{ value: Theme }>({ value: (localStorage.getItem('listoff.theme') as Theme) || 'system' });
export function applyTheme(t: Theme) {
  theme.value = t;
  localStorage.setItem('listoff.theme', t);
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

// ---- hash router ----
export interface Route { name: 'home' | 'account' | 'list'; id?: string; tab?: 'list' | 'shelf' | 'activity' | 'manage' }
function parse(): Route {
  const h = location.hash || '#/';
  const m = h.match(/^#\/list\/([A-Za-z0-9]+)(?:\/(shelf|activity|import|members|manage))?$/);
  if (m) {
    const t = m[2];
    return { name: 'list', id: m[1], tab: t === 'import' || t === 'members' || t === 'manage' ? 'manage' : (t as Route['tab']) || 'list' };
  }
  return h === '#/account' ? { name: 'account' } : { name: 'home' };
}
export const router = $state<{ route: Route }>({ route: parse() });
const depth = (r: Route) => (r.name === 'home' ? 0 : 1);

window.addEventListener('hashchange', () => {
  const next = parse();
  const dd = depth(next) - depth(router.route);
  if (dd) document.documentElement.dataset.nav = dd > 0 ? 'push' : 'pop';
  router.route = next;
});
export const go = (hash: string) => { location.hash = hash; };
