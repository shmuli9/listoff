# listoff

Shared shopping lists. Plain HTML/CSS/JS PWA on GitHub Pages, a small Cloudflare Worker
backend (`worker/`), and encrypted per-list storage in GitHub gists.

## Architecture

- **Frontend** (this repo, served by GitHub Pages): static PWA. No build step.
- **Worker** (`worker/`): login (PBKDF2 + server-side pepper), per-list authorisation,
  gist reads/writes, AES-GCM encryption of all stored data. Secrets live in Worker
  secrets only, never in this repo.
- **Storage**: one encrypted gist per list plus one encrypted system gist (users + list
  registry). GitHub only ever sees ciphertext.

## Concurrency model

Each list is its own gist record. Saves use optimistic concurrency: the client sends the
gist revision it based its edit on; if the list moved on, the Worker merges item-by-item
(last write wins per item, tombstones for deletes, log union capped at 500 entries) and
re-checks after writing to converge on racing writers. Tested with simultaneous edits
before launch; not a formal guarantee.

## Deploy

1. `cd worker && npx wrangler deploy` (needs a Cloudflare API token with Workers edit).
2. Set secrets: `GITHUB_TOKEN` (classic PAT, gist scope), `SESSION_SECRET`, `PEPPER`,
   `DATA_KEY`, `SYSTEM_GIST_ID` - see `tools/bootstrap.mjs`, which generates them and
   creates the system gist.
3. Push this repo and enable GitHub Pages on the default branch (root).

## Features (v1)

- Multiple lists, per-list memberships enforced server-side
- Add items with quantity, note, automatic category grouping
- Type-ahead suggestions and a "Previously added" shelf per list (scoped to that list's
  members - nothing leaks between lists)
- Tick off (stays visible, undo), delete, clear done
- Per-list activity log (who did what, when)
- Plain-text import (AnyList "Send a Copy" output works, as does any one-per-line text)
- Change password, sign out
- Installable PWA (manifest + service worker caching only the app shell, never list data)
