---
name: install-lockpad
description: Install, run, update, or repair Lockpad, the self-hosted notes app. Use when the user asks to install Lockpad, set it up, self-host it, get it running on a NAS or server, expose it over Tailscale, set up HTTPS on their LAN, configure backups, or fix a broken install.
---

# Installing Lockpad

Lockpad is a self-hosted, single-user notes app. It runs entirely on hardware the user owns, has no vendor server, no accounts, and no telemetry. Everything below runs on their machine.

**There is an installer. Use it.** `install.sh` generates every secret, writes a correct `.env`, pulls prebuilt images, starts the stack, and waits for health. Do not hand-roll the steps it already does. The manual path exists for people building from source, and is documented in `DEPLOY.md`.

## Before anything: are you on the right machine?

Lockpad must be installed on **the machine that will run it and stay on**, not on the user's laptop unless that is the machine.

Run `hostname` and have the user confirm. If it is the wrong machine, offer two options and wait:

1. Run Claude Code on that machine instead.
2. Work over SSH from here. If they choose this, confirm you can reach the host with a trivial command first, then run **every** command over that connection. Do not mix local and remote commands, which is the fastest way to a half-installed system.

## Rules about secrets

Someone chose this product so their notes are not on somebody else's server. Do not undermine that during install.

- **Never print a secret into the conversation.** `install.sh` generates them and writes them straight to `.env` with `umask 077`. Leave it that way.
- **Never ask the user to type their app password into the chat.** The installer prompts for it on the terminal with `read -rs`, so it is never echoed. Let the installer ask. If you are doing a manual install, stop and have the user edit `.env` themselves.
- **Never `cat` the finished `.env`.** To check a variable is set, test the key and not the value: `grep -q '^APP_PASSWORD=.\+' .env && echo set`.
- If the user pastes a secret into the chat anyway, tell them it is now in their conversation history and they should change it.

## Preflight

Report these together rather than one at a time:

```bash
docker --version
docker compose version
docker info >/dev/null 2>&1 && echo "docker running"
df -h .
```

If Docker is missing, do not install it silently. On a NAS the correct route is usually the vendor's own package manager, not a generic script. Ask first.

## Step 1 — Run the installer

From inside a checkout:

```bash
bash install.sh
```

Or standalone, with no clone at all:

```bash
curl -fsSL https://raw.githubusercontent.com/Colbysdovi/Lockpad-Public/main/install.sh | bash
```

The installer is interactive and reads from `/dev/tty`, so it works even when piped from curl. It asks exactly two things:

1. **A login password**, entered hidden and confirmed. Blank disables auth entirely.
2. **Where it listens** — localhost only (default), or the whole local network.

It then generates `POSTGRES_PASSWORD` and `SESSION_SECRET`, writes `.env` at mode 600, pulls the GHCR images via `docker-compose.public.yml`, starts everything, and polls `/api/health` for up to 60 seconds.

**Two things to watch for:**

- If `.env` already exists, the installer offers to keep it and just restart. Do not talk the user into overwriting it, because that path loses their database password while the volume keeps the old one.
- If the user picks network access **and** leaves the password blank, the installer stops and makes them confirm. Do not auto-confirm that on their behalf. Read the warning out and let them decide.

**Migrations are not a separate step.** The backend applies pending migrations itself on startup. Do not run `prisma:deploy` by hand. If someone tells you migrations are missing, watch them land with `docker compose -f docker-compose.public.yml logs -f backend` instead.

## Step 2 — Verify before declaring success

The installer does this itself, but if you ran anything manually, confirm:

```bash
docker compose -f docker-compose.public.yml ps
docker compose -f docker-compose.public.yml exec -T backend wget -qO- http://localhost:4000/api/health
```

Expect all containers up and `{"status":"ok"}`. A confident "all set" over a broken install is worse than no help.

## Step 3 — Remote access

Ask which the user wants. These are not mutually exclusive and running both is usually right: the tailnet URL from outside the house, the LAN URL from inside.

### Tailscale, for reaching it from anywhere

Needs an auth key from login.tailscale.com → Settings → Keys, which the user generates and puts in `.env` as `TS_AUTHKEY`.

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Joins the tailnet as `lockpad`, served at `https://lockpad.<their-tailnet>.ts.net`. Set `COOKIE_SECURE=true` and point `CORS_ORIGINS` at that URL.

**Never use `tailscale funnel`.** `serve` keeps it private to the tailnet; `funnel` publishes it to the public internet and breaks the core promise of the product. If the user asks for funnel, explain what it does and get explicit confirmation.

**Tell them to disable key expiry.** Admin console → Machines → `lockpad` → ⋯ → Disable key expiry. A node key expires 180 days after login by default, and when it does the node silently drops off the tailnet. This is the single most likely way for a working install to break months later, and it takes one click to prevent.

### Direct HTTPS on the LAN, no Tailscale client needed

For devices on the same network. Covered fully in `DEPLOY.md` §9. The short version: issue a certificate with `mkcert` on a machine the user trusts, copy the pair into `certs/`, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.lan-tls.yml up -d
```

Reachable at `https://<nas-ip>:5174`.

### Do not suggest plain HTTP over the LAN as a convenience

This is the mistake to actively prevent. Browsers only expose `window.crypto.subtle` in a **secure context**, and Lockpad's per-note locking is built on it. Over `http://<nas-ip>:5173` the lock feature refuses to run. It is not a bug and there is no flag for it.

Plain HTTP on the LAN is fine for localhost-only access and acceptable as the emergency measure in `DEPLOY.md` §8, but never present it as a normal way to run the app. If the user is on it, tell them per-note locking will not work until they are on HTTPS, and why.

## Step 4 — Backups

Do not treat this as optional. Nobody else has a copy of their notes, which is the point and also the risk.

```bash
./scripts/backup.sh
```

Confirm a file appeared in `backups/`. Then offer the cron entry:

```
30 2 * * *  /path/to/Lockpad/scripts/backup.sh >> /var/log/lockpad/backup.log 2>&1
```

On a NAS, the vendor's task scheduler is usually a better home for this than crontab. Restore is `./scripts/restore.sh backups/<file>.sql.gz`. Suggest they actually try a restore once, because an untested backup is a guess.

## Updating

Back up first. Always.

```bash
./scripts/backup.sh
docker compose -f docker-compose.public.yml pull
docker compose -f docker-compose.public.yml up -d
```

From a source checkout it is `git pull && docker compose up -d --build`. Migrations run themselves either way. Settings → About shows which version they landed on.

## When things go wrong

- **Login fails** — usually `APP_PASSWORD` set with `SESSION_SECRET` empty, or `COOKIE_SECURE=true` while actually serving plain HTTP, which silently breaks the session cookie. Check both match reality.
- **Backend unhealthy** — normally `DATABASE_URL` not matching `POSTGRES_PASSWORD`. Check both were written together, without printing either. The installer cannot produce this; hand-editing can.
- **Locking button does nothing** — almost always plain HTTP. See step 3.
- **Reachable on LAN but not over Tailscale** — check the node is present in the admin console, that the key has not expired, and that `CORS_ORIGINS` matches the `.ts.net` URL exactly.
- **Edited `nginx-tls.conf` and nothing changed** — it is bind-mounted as a single file, so the container holds the old inode. `up -d` is not enough; use `up -d --force-recreate frontend`.
- **Locked out entirely** — `DEPLOY.md` §8 has the SSH escape hatch that widens the frontend bind back to the LAN.
- **Rate limited** — 600 requests/minute and 10 login attempts per 15 minutes by default, tunable in `.env`. Normal use never hits these, so if the user does, look for a loop before raising the ceiling.

## What to tell the user at the end

1. The URL to open, and which devices it works from.
2. That the app password has no reset and no recovery email, and to store it now.
3. That locked notes use a separate passphrase which genuinely cannot be recovered by anyone, including them.
4. Where backups are written and when they run.
5. If Tailscale is in use, that they should disable key expiry now.
6. That nothing about Lockpad talks to any server other than their own, including this install session. You helped set it up; you are not part of running it.

## Things not to do

- Do not publish the Postgres port. It is unmapped on purpose. Use `docker compose exec` to reach it.
- Do not add analytics, telemetry, or error reporting to make debugging easier. Zero outbound requests is a public product claim.
- Do not use `tailscale funnel`.
- Do not run migrations by hand.
- Do not present plain HTTP over the LAN as a normal configuration.
- Do not invent commands. If something is not here or in `DEPLOY.md`, read the repo and say what you found rather than guessing. If this skill and the repo disagree, **the repo wins** and you should say this skill is out of date.
