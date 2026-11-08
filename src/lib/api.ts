export const API: string = import.meta.env.VITE_API || 'https://listoff-api.shmuli9.workers.dev';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let token: string | null = null;
let onExpired = () => {};
export const setToken = (t: string | null) => { token = t; };
export const setExpiredHandler = (f: () => void) => { onExpired = f; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("You're offline", 0);
  }
  if (res.status === 401 && token) { onExpired(); throw new ApiError('Session expired', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status);
  return data as T;
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

export const newSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

// The Worker only ever sees this derived proof, never the password.
export async function deriveProof(password: string, saltHex: string, iterations: number) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, km, 256);
  return toHex(new Uint8Array(bits));
}
