# 📓 Lockpad — project context for Claude

Lockpad is a self-hosted, single-user notes app. It runs entirely on hardware the user owns, has no vendor server, no accounts, and no telemetry.

If someone asks you to **install, set up, self-host, deploy, update, or repair Lockpad**, use the `install-lockpad` skill in `.claude/skills/`. Do not improvise from the README — there is a real installer, and hand-rolling the steps it already does is how installs break.

## 🧩 Stack

- **frontend** — Vite + React SPA (Watermelon/shadcn + Tailwind), TipTap editor, built to static files, served by nginx. nginx proxies `/api` to the service literally named `backend`.
- **backend** — Fastify + Prisma, REST/JSON API. Applies pending DB migrations itself on startup via `docker-entrypoint.sh`.
- **postgres** — official image, never published outside the internal Docker network.

## 🐳 Compose files, and which is which

| File | Purpose |
|---|---|
| `docker-compose.yml` | Build from source. The developer path. |
| `docker-compose.public.yml` | Pull prebuilt GHCR images. What `install.sh` uses, and what end users get. |
| `docker-compose.tailscale.yml` | Overlay. Sidecar that joins the tailnet and serves HTTPS. |
| `docker-compose.lan-tls.yml` | Overlay. Direct HTTPS on the LAN with your own mkcert certificate. |

Overlays compose together. Running the tailnet and LAN-TLS paths at once is a supported, common setup.

Images are `ghcr.io/<owner>/lockpad-backend` and `ghcr.io/<owner>/lockpad-frontend`, built and published by CI on pushes to `main`, on `v*` tags, and on manual dispatch.

## 🚨 Things that are load-bearing, not incidental

These are public product promises. Changing any of them silently would make the project's own landing page false.

1. **Zero outbound network requests in normal operation.** No analytics, no telemetry, no CDN-hosted fonts or scripts, no external APIs, no error reporting. If a remote call would make something easier, do not. Solve it locally or raise it.
2. **Postgres has no host port mapping.** Only the backend reaches it. Do not add one, not even temporarily for debugging.
3. **Tailscale `serve`, never `funnel`.** `serve` keeps the app private to the tailnet. `funnel` publishes it to the internet.
4. **Locked notes are encrypted client-side.** AES-GCM-256, key derived by PBKDF2-SHA-256 at 600,000 iterations, via WebCrypto in the browser. The server stores `encryptedContent` plus KDF parameters, never the key or the plaintext. The passphrase must never reach the backend.
5. **Single-user by design.** One `APP_PASSWORD` for the whole app. There is no multi-user model, and adding one is a product decision rather than a refactor.

## 🔒 The secure-context constraint

`window.crypto.subtle` is only available in a secure context, so **per-note locking cannot work over `http://<ip>`**. This is why plain HTTP on the LAN is not offered as a normal configuration, and why `docker-compose.lan-tls.yml` exists. Anything that would move users onto plain HTTP silently disables a headline feature. Treat that as a correctness constraint, not a preference.

## 📂 Data model, briefly

Notes carry TipTap JSON content, an optional independent `color`, an optional folder, tags, bidirectional links (`linksFrom` / `linksTo`), soft delete, and archive. Folders are a tree with their own separate `color`. Pinning is scoped per list view, so a note can be pinned in "all", in a folder, and under a tag independently. Full-text search uses a generated Postgres `tsvector` column added by raw SQL migration, since Prisma cannot express it.

**Note colors and folder colors are separate, independent fields.** Do not collapse them.

## 🔑 Secrets

`.env` is gitignored and must never be committed, printed, or pasted into a conversation. `install.sh` generates secrets and writes them with `umask 077`. When working manually, write secrets straight into the file rather than echoing them, and let the user set `APP_PASSWORD` themselves.

`certs/` is gitignored and holds a private key. It must never reach a repository, public or private.

## 💻 Conventions

- Migrations apply automatically on backend startup. Do not run `prisma:deploy` by hand and do not edit the database directly.
- `nginx-tls.conf` is bind-mounted as a single file, so it binds to an inode. After editing it, recreate the container with `up -d --force-recreate frontend` — a plain `up -d` silently keeps serving the old config.
- **Never write a Tailwind opacity modifier on a palette colour** (`bg-primary/90`, `text-muted-foreground/70`). Every palette token is a `var()` holding a hex, and Tailwind emits *no CSS at all* for those — the failure is silent, in review and at runtime. Use `bg-[color-mix(in_srgb,var(--primary)_90%,transparent)]`. `npm run lint:palette` (in `frontend/`, and part of `npm run build`) fails on any that reappear.
- **Every heading in a published document gets an emoji before it**, and the emoji means a concept rather than a document — privacy is 🔒 in the README, the FAQ and the changelog alike. Reuse the emoji an existing heading already uses for that concept; two emoji for one idea is how the system decays. Two traps, both silent: an emoji needing a U+FE0F variation selector (⌨️ ⚠️ 🏗️ 🏷️ …) leaves that invisible character inside the anchor slug, and *any* emoji shifts the anchor to a leading hyphen (`## 🔒 Privacy` → `#-privacy`), so links to that heading move with it.
- Packaging manifests for three home-server app stores live outside this repository. They are packaging only and never modify application code, and they are deliberately unnamed here — the listings have no date, so nothing published mentions them until they do. If your change adds an env var or moves an image tag, say so in the PR: those manifests have to move with it.
- `DEPLOY.md` is the source of truth for deployment. If it disagrees with this file, `DEPLOY.md` wins and this file needs updating.
- License is AGPL-3.0. Keep it that way.
