# Lockpad app-store packaging

Manifests that let non-technical self-hosters install Lockpad with a **click**
from a home-server app store, instead of touching a terminal. All of them pull
the prebuilt GHCR images (see `.github/workflows/publish-images.yml`) — so
**Tier 0 must be published first**: the images have to exist and be public.

| Store | Audience | Folder | How it's delivered |
| ----- | -------- | ------ | ------------------ |
| [CasaOS](https://casaos.io) | Home-server / mini-PC | `casaos/` | Usable **now** via *Custom Install → Import* with the compose file. No PR needed. |
| [Umbrel](https://umbrel.com) | Umbrel OS / umbrelOS | `umbrel/` | Submit as a PR to [`getumbrel/umbrel-apps`](https://github.com/getumbrel/umbrel-apps). |
| [Runtipi](https://runtipi.io) | Runtipi servers | `runtipi/` | Submit to [`runtipi/runtipi-appstore`](https://github.com/runtipi/runtipi-appstore), or add as a custom app store. |

Each store front-ends the **frontend** container (nginx), which proxies `/api`
to the **backend** container internally. Postgres is never exposed. Because the
frontend's baked-in nginx config proxies to the host literally named `backend`,
every manifest keeps a `backend` service (or network alias) — do not rename it.

## Secrets

The images are the same everywhere; only *how each store supplies secrets*
differs:

- **`POSTGRES_PASSWORD`** — protects the internal DB. It has no host port and is
  only reachable by the backend, so a per-install value is good hygiene but not
  internet-facing.
- **`SESSION_SECRET`** — signs the login cookie. Should be unique per install.
- **`APP_PASSWORD`** — the user's chosen login password (may be blank).

Runtipi generates `random` fields for you (wired below). CasaOS and Umbrel don't
auto-generate, so the manifests ship documented placeholders. **Before
submitting a PR, wire that store's secret mechanism** (Umbrel: derive from
`$APP_SEED` in the app-store repo's `exports.sh`; CasaOS: mark the fields
required in the install form) rather than shipping fixed secrets.

## Keeping them in sync

When the images change tag or a new env var is added, update all three
manifests plus `docker-compose.public.yml` together. These files are packaging
only — they never modify application code.
