# listoff

Shared shopping lists, built to feel native on Android and iOS. Svelte 5 PWA on GitHub Pages,
a small Cloudflare Worker (`worker/`), and encrypted per-list storage in GitHub gists.

## Architecture

- **Frontend** (`src/`): Svelte 5 + Vite + TypeScript, installable PWA.
  - The hashed app shell is precached and served cache-first.
  - Lists live in `localStorage` per user and render before any network call. Edits apply and
    persist instantly, then sync in the background. The cache is wiped on sign-out.
- **Worker** (`worker/`): login (PBKDF2 + server-side pepper), per-list authorisation, gist
  reads/writes, AES-GCM encryption. Secrets live in Worker secrets only.
- **Storage**: one encrypted gist per list plus one encrypted system gist. GitHub only sees ciphertext.

## Sync

Saves are optimistic: the client sends the gist revision it based its edit on, and the Worker
merges item by item if the list moved on (last write wins per item, tombstones for deletes).
`worker/merge.js` is shared by client and Worker so both converge the same way. Shared edits
arrive by polling every 15s while the app is visible, and immediately on resume.

## Develop

    npm install
    npm run mock                                # real worker.js, in-memory fake of GitHub's API, port 8787
    VITE_API=http://localhost:8787 npm run dev  # add your dev origin to mock via ORIGIN=...

Sign in as `alice` or `bob`, password `correct-horse`.

    npm test          # logic unit tests
    npm run check     # types
    npm run e2e       # Playwright: Pixel 7 (Chromium) and iPhone 15 (WebKit) profiles

`node tools/splash.mjs` regenerates the iOS launch images.

## Deploy

1. `cd worker && npx wrangler deploy` (deploy this first). Secrets: `GITHUB_TOKEN` (classic PAT, gist
   scope), `SESSION_SECRET`, `PEPPER`, `DATA_KEY`, `SYSTEM_GIST_ID`; see `tools/bootstrap.mjs`.
2. In the repo's Settings > Pages, set Source to **GitHub Actions**. Pushing to the default branch
   then builds and publishes `dist/`.
