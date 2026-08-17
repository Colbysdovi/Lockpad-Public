# Self-hosting Lockpad on the UGREEN NAS

Three containers via Docker Compose — `postgres`, `backend` (Fastify + Prisma),
`frontend` (static SPA served by nginx). Postgres is **never** published outside
the internal Docker network. Remote access is over Tailscale only; nothing is
exposed to the public internet.

Run every command below **on the NAS** (UGOS Pro → Docker, or over SSH). This
machine (where the code was written) has no access to your tailnet.

## 1. First-time setup

```bash
# Clone the repo onto the NAS (replace with wherever you host it)
git clone https://github.com/<your-username>/Lockpad.git
cd Lockpad

# Configure secrets
cp .env.example .env
```

Edit `.env`:

| Variable            | What to set it to                                                              |
| ------------------- | ------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | A long random string (`openssl rand -hex 32`).                                 |
| `DATABASE_URL`      | Use the same password: `postgresql://lockpad:<PW>@postgres:5432/lockpad?schema=public` |
| `CORS_ORIGINS`      | Your MagicDNS URL, e.g. `https://lockpad.<your-tailnet>.ts.net`                 |
| `APP_PASSWORD`      | The single login password for the app. Leave empty only to disable auth.       |
| `SESSION_SECRET`    | Signs the login session — `openssl rand -hex 32`. Required when `APP_PASSWORD` is set. |
| `COOKIE_SECURE`     | `false` for plain HTTP over the tailnet; `true` if you front it with `tailscale serve` (HTTPS). |
| `FRONTEND_PORT`     | Leave `5173` unless it clashes with another service.                           |

`.env` is gitignored and never leaves the NAS.

## 2. Build, run, migrate

```bash
docker compose build
docker compose up -d
```

**Migrations are not a step you run.** The backend container applies every pending
migration itself on startup, before it begins serving (`backend/docker-entrypoint.sh`
runs `prisma migrate deploy`). It is idempotent, so a restart with nothing pending is a
no-op. Watch them land instead of invoking them:

```bash
docker compose logs backend | grep -i migration
# "N migrations found" then either "Applying migration …" or "No pending migrations to apply."
```

Running `prisma migrate deploy` by hand is not just redundant, it is how people get into
trouble: it invites the habit of reaching into the database to fix a failed migration,
and a half-applied schema is far harder to recover than a container that refuses to
start. If the backend cannot migrate, it exits and says why in its logs. Read those.

- The frontend binds to `127.0.0.1:5173` on the NAS (not the LAN).
- Postgres has **no** host port mapping — only `backend` can reach it.
- Data lives in the `pgdata` Docker volume and survives rebuilds.

## 3. Expose it

**LAN / tailnet-IP (simple):** set `FRONTEND_BIND=` (empty) in `.env` and
`docker compose up -d`. Reachable at `http://<nas-ip>:5173`. Only do this once
`APP_PASSWORD` is set.

**Its own tailnet node over HTTPS (recommended for remote):** use the sidecar
overlay. Put a Tailscale auth key in `.env` (`TS_AUTHKEY=…`, from
login.tailscale.com → Settings → Keys), then:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Joins the tailnet as `lockpad` and serves HTTPS at
`https://lockpad.<your-tailnet>.ts.net` (via `tailscale serve`, never funnel).
Set `COOKIE_SECURE=true` in `.env` when using HTTPS. Tighten your Tailscale ACLs
so only your own devices can reach the node.

**Running both paths at once is normal**, and usually what you want: the tailnet URL
from outside the house, the LAN URL from inside (§9). They coexist.

### Pin your compose files once, so a later command cannot silently drop one

Every overlay you add is a flag you have to repeat on *every* later `docker compose`
command in this directory. This is the sharpest edge in the whole setup, because
forgetting one is not an error. It is a quietly different deployment. Recreate the
frontend without `docker-compose.lan-tls.yml` and its `5174:443` port mapping simply
disappears: the container starts, reports healthy, serves correctly on the NAS itself,
and the app stops answering on your LAN. Nothing in `docker compose ps` says "you lost
a port", because as far as Compose is concerned you asked for exactly this.

So write the choice down once, in `.env`, instead of remembering it:

```bash
# .env — every `docker compose` command run in this directory now uses these files.
# List only the overlays you actually use; drop the ones you do not.
COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml:docker-compose.lan-tls.yml
```

Compose reads `COMPOSE_FILE` from the project directory's `.env`, so a bare
`docker compose up -d` now carries all three, and so do `build`, `ps`, `logs`, and the
update in §4. Separate the paths with `:`. Confirm it took effect before relying on it:

```bash
docker compose config | grep -B1 published    # expect both 5173 and 5174
```

Explicit `-f` flags still work and take precedence over `COMPOSE_FILE`. If you prefer
them, the rule is simply that the full set must appear on every command, not just the
first one.

## 4. Updating after new code is pushed to GitHub

Back up first — one command, and it is the difference between a bad update costing
you an evening and costing you your notes (§5).

```bash
cd Lockpad
./scripts/backup.sh
git pull
docker compose up -d --build
```

Migrations are **not** a separate step: the backend container applies any pending
ones itself on startup (`docker-entrypoint.sh`). Watch them land with
`docker compose logs -f backend`.

That bare `docker compose up -d --build` is only correct if `COMPOSE_FILE` is set in
`.env` (§3) or you have added every `-f` overlay by hand. Without one of those, this
command rebuilds your deployment **without** your overlays and takes their published
ports with it.

Which version you end up on is visible in the app under **Settings → About**. A
build from source reports itself as a development build rather than a release
number, which is correct — there is no tag behind it.

## 5. Backups

A nightly `pg_dump` script is included:

```bash
./scripts/backup.sh                 # writes backups/lockpad-<timestamp>.sql.gz
# cron (UGOS task scheduler), 2:30am daily:
#   30 2 * * *  /path/to/Lockpad/scripts/backup.sh >> /var/log/lockpad/backup.log 2>&1
```

Restore with `./scripts/restore.sh backups/lockpad-<timestamp>.sql.gz`.

## 6. Health check

```bash
docker compose ps
docker compose logs -f backend
curl -I http://localhost:5173/                     # frontend → 200
docker compose exec backend wget -qO- http://localhost:4000/api/health   # {"status":"ok"}
```

Every command above runs **on the NAS**, and that is their blind spot: they all reach
the app over loopback or the internal Docker network, which works even when nothing is
published to your network. A healthy result here is entirely compatible with the app
being unreachable from every device you own.

So finish from a **different machine** — the actual promise you care about:

```bash
# From your laptop, not the NAS.
curl -I https://<nas-ip>:5174/                     # LAN-TLS path (§9) → 200
curl -I https://lockpad.<your-tailnet>.ts.net/     # tailnet path (§3) → 200
```

Check whichever paths you have turned on, and check them after any change that
recreated the frontend.

## 7. Security controls

Three things guard the server itself, on top of the note-level encryption.

**A warning if the app is open to your network.** Reaching Lockpad from other
machines means broadening `FRONTEND_BIND`; running without a login means leaving
`APP_PASSWORD` empty. Either is a supported choice. Together they mean anyone on the
network can read and edit every unlocked note, so the server says so — at startup in
`docker compose logs backend`, and in the app under **Settings → Security**. It warns
and carries on; the choice stays yours.

**Rate limits.** 600 requests a minute per client across the API, and 10 login
attempts per 15 minutes. Both are far above normal use — they exist to stop a
password-guessing script or a runaway client, not to throttle you. Health and login
status are exempt so the app can always start. Tune with `RATE_LIMIT_MAX`,
`LOGIN_RATE_LIMIT_MAX` and friends (see `.env.example`).

**Session revocation.** Sessions are signed tokens the server does not store, so
losing a logged-in device used to mean rotating `SESSION_SECRET` and signing every
device out. **Settings → Security → Sign out other devices** now ends every session
but the one you are using. A single session can also be revoked by id:

```bash
curl -X POST http://localhost:5173/api/auth/session/revoke \
  -H 'content-type: application/json' -b "$COOKIE" -d '{"id":"<session id>"}'
```

`GET /api/auth/session` reports the id of the session making the request.

> Applying these to an existing install needs one migration, which creates the two
> small tables that record revoked sessions. It runs automatically the first time
> the updated backend starts — there is nothing to type. Back up first (§5).

## 8. Recovery — getting back in when Tailscale is unavailable

Routing access through a tailnet adds a dependency, and it is worth being precise
about how much of one. Tailscale is a **coordination** service, not the path your
data takes: it brokers keys and endpoints, and once two machines have exchanged
those they talk to each other directly. On a home network that means your laptop
reaches the NAS peer-to-peer over your own LAN, encrypted by WireGuard, at
sub-millisecond latency. Confirm it for yourself:

```bash
tailscale ping lockpad     # "direct <lan-ip>:<port>" = peer-to-peer, not relayed
tailscale status           # the lockpad line should read "direct", not "relay"
```

The consequence is that Tailscale's own servers going down does **not** cut you off
from an already-established connection. What a control-plane outage actually stops
is registering new devices, rotating keys, propagating ACL changes and renewing
certificates — none of which you need in order to keep using a link that already
works.

| What fails                          | Effect on access            | Fix                                          |
| ----------------------------------- | --------------------------- | -------------------------------------------- |
| Tailscale client off on your machine | no access                   | turn it on                                    |
| Tailscale's service down for hours   | **none** — direct LAN path  | nothing                                       |
| Sidecar container stopped on the NAS | no access                   | `docker compose … up -d tailscale`            |
| **Node key expires**                 | **no access, from anywhere** | disable key expiry — see below                |
| Outage long enough to cross cert renewal | eventually breaks       | the escape hatch below                        |

Only one of those has a date attached, and it is the one to deal with in advance:
in the admin console, open **Machines → `lockpad` → ⋯ → Disable key expiry**. A
node key expires 180 days after login by default, and when it does the node drops
off the tailnet with no warning and no LAN fallback if you closed that port.

### The escape hatch

You are never actually locked out, because SSH is a completely independent path —
it does not know or care that Tailscale exists. From any machine on the same LAN
as the NAS:

```bash
ssh <nas-user>@<nas-ip> 'cd <path-to-lockpad> && sed -i "s|^FRONTEND_BIND=.*|FRONTEND_BIND=|" .env && docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d frontend'
```

That widens the frontend's bind from loopback back to the LAN and recreates the one
container, reopening `http://<nas-ip>:5173` in about thirty seconds. If SSH happens
to be disabled too, the NAS's own web administration UI reaches the same setting
through Container Manager.

Two things worth knowing before you rely on it. Reopening the LAN port puts you back
on plain HTTP, which means traffic is readable to anyone else on the network **and**
`crypto.subtle` is unavailable outside a secure context — so per-note locking will
refuse to run until you are back on HTTPS. Treat it as a way to get to your notes
during an outage, not a configuration to leave in place. Set `COOKIE_SECURE=false`
while you are on it, and put both settings back when the tailnet returns.

The point of writing this down is that the moment you need it is exactly the moment
you cannot reach the machine that has the notes explaining it. Keep a copy somewhere
that does not depend on Lockpad being up.

## 9. Direct HTTPS on your own network (no Tailscale client needed)

§3's tailnet node solves reaching your notes from anywhere. It is a poor fit for
the machine sitting on the same desk as the NAS, where it puts a third party's
coordination service in the path of a conversation between two devices ten feet
apart — and means opening a VPN client before you can read a shopping list.

The obvious shortcut is to reopen the LAN port on plain HTTP. Don't, other than as
the emergency measure in §8: browsers expose `window.crypto.subtle` only in a
**secure context**, and Lockpad's per-note locking is built on it. Over
`http://<nas-ip>` the lock button refuses to run, correctly but permanently. The
encryption on the network hop is worth having anyway; the secure context is the
part that is not optional.

So terminate TLS on the NAS with a certificate you issue yourself. No public CA is
involved, nothing about your network is published to a certificate transparency
log, and the result is a normal trusted-padlock HTTPS origin on your LAN.

### Issue the certificate

On any machine you already trust (your laptop is the natural choice — the CA's
private key should live somewhere you control, not on the NAS). [mkcert][mkcert]
is the least error-prone way; it creates a local certificate authority and adds it
to your OS trust store in one step.

```bash
brew install mkcert          # macOS; apt/choco/pacman all package it too
mkcert -install              # create the local CA and trust it on THIS machine

# Name every address you will actually type. An IP must be listed as an IP,
# and a certificate cannot be issued for a name you have not asked for.
mkcert -cert-file lockpad.pem -key-file lockpad-key.pem <nas-ip> lockpad.local
```

Copy the pair to the NAS, into a `certs/` directory beside the compose files:

```bash
ssh <nas-user>@<nas-ip> 'mkdir -p <path-to-lockpad>/certs'
scp lockpad.pem lockpad-key.pem <nas-user>@<nas-ip>:<path-to-lockpad>/certs/
```

`certs/` is gitignored — it holds a private key, and that key must never reach a
repository, public or private.

### Turn it on

```bash
docker compose -f docker-compose.yml -f docker-compose.lan-tls.yml up -d
```

Add `-f docker-compose.tailscale.yml` as well to run both paths at once, which is
usually what you want: the tailnet URL from outside the house, the LAN URL from
inside. They coexist — the sidecar keeps proxying to the frontend's plain-HTTP port
over the internal Docker network, which never touches your LAN. Once you have
settled on your set of files, pin it in `.env` with `COMPOSE_FILE=` (§3): otherwise the
next `docker compose up -d` that forgets a `-f` silently removes the `5174` mapping and
the app goes quiet on your LAN while still looking healthy on the NAS.

Reachable at `https://<nas-ip>:5174` (change with `FRONTEND_TLS_PORT`). `COOKIE_SECURE=true`
stays correct, because this path is HTTPS too. `CORS_ORIGINS` needs no new entry:
nginx proxies `/api` on the same origin as the page, so the browser never makes a
cross-origin request.

> **When you later edit `nginx-tls.conf`, recreate the container** — a plain
> `up -d` is not enough:
>
> ```bash
> docker compose … up -d --force-recreate frontend
> ```
>
> That file is bind-mounted as a *single file*, and a single-file mount binds to an
> inode, not a path. Any update that replaces the file rather than editing it in
> place — `git pull`, `tar`, most editors writing atomically — leaves the container
> holding the old inode, serving the previous config while the new one sits on disk
> looking correct. `nginx -t` passes, `nginx -s reload` reports success, and nothing
> changes. Rebuilds (`--build`) recreate the container anyway, so this only bites
> when the config is the only thing that changed.

### Trust the certificate on your other devices

`mkcert -install` covered the machine that issued it. Everything else needs the CA
certificate — **the CA, not the server certificate**. Find it with `mkcert -CAROOT`;
the file is `rootCA.pem`. Send *only that file* to your other devices; `rootCA-key.pem`
sitting next to it is the private key that can mint certificates for any site on
earth, and it should never leave the machine that made it.

- **macOS** — double-click `rootCA.pem`, then in Keychain Access set it to *Always Trust*.
- **iOS/iPadOS** — AirDrop or mail it to yourself, install the profile in Settings,
  then separately enable it under **Settings → General → About → Certificate Trust
  Settings**. Installing without that second step is the usual reason it still fails.
- **Android** — Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
- **Firefox** on any platform keeps its own trust store: Settings → Privacy & Security
  → View Certificates → Authorities → Import.

### Verify

```bash
curl -sS -o /dev/null -w 'tls-verify=%{ssl_verify_result} http=%{http_code}\n' \
  --cacert "$(mkcert -CAROOT)/rootCA.pem" https://<nas-ip>:5174/
```

`tls-verify=0 http=200` means the chain validated. In the browser, confirm the
padlock and then open a note and lock it — locking working end to end is the real
proof the secure context is in place, which is the thing plain HTTP could not give
you.

Certificates from `mkcert` are dated years out, so this is not a renewal treadmill,
but it is not forever either: note the expiry somewhere you will see it, and reissue
with the same command when the day comes.

[mkcert]: https://github.com/FiloSottile/mkcert
