#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lockpad one-command installer.
#
# Turns "clone, generate secrets by hand, build, migrate" into: run this, answer
# two questions. It generates all secrets for you, writes a correct .env (so the
# DB password can never be mismatched), pulls the prebuilt images, and starts the
# app. The backend applies DB migrations itself on startup.
#
#   Run inside a checkout:      bash install.sh
#   Or straight from the web:   curl -fsSL https://raw.githubusercontent.com/Colbysdovi/Lockpad-Public/main/install.sh | bash
#
# Nothing here contacts the internet except Docker pulling the images. No
# telemetry, no analytics. .env stays on this machine and is gitignored.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Colbysdovi/Lockpad-Public/main"

# Which release this installer installs.
#
# This is the whole reason releases mean anything. The compose file resolves the
# image as ${TAG:-latest}, and `latest` is rebuilt on EVERY push to main — so
# without a pin, "install Lockpad" means "install whatever was committed most
# recently", and an install done twenty minutes apart can give two people
# different software under the same name. Writing TAG into .env makes an install
# reproducible: it stays on this exact release until someone deliberately moves it.
#
# scripts/release.sh rewrites this line, so it cannot drift from the tag that was
# actually cut. If you are editing it by hand, you are probably doing it wrong.
LOCKPAD_VERSION="v1.0.0"
COMPOSE_FILE="docker-compose.public.yml"
TS_FILE="docker-compose.tailscale.yml"
TS_SERVE="tailscale/serve.json"

# Which compose files every command in this script uses.
#
# An array, not a string, and it matters: the optional Tailscale overlay is a
# SECOND -f flag, and Compose's rule is that the full set has to appear on every
# single command. Miss it once and you have not got an error, you have got a
# quietly different deployment — the sidecar simply is not there and nothing says
# so. Building the list once and passing "${DC_FILES[@]}" everywhere is what makes
# that impossible to get wrong here.
DC_FILES=(-f "$COMPOSE_FILE")

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\033[31m  x %s\033[0m\n' "$1" >&2; exit 1; }

# Read interactively even when this script is piped from curl (stdin is the
# script, so prompts must come from the controlling terminal).
if [ -r /dev/tty ]; then TTY=/dev/tty; else TTY=/dev/stdin; fi
ask()      { local p="$1" d="${2:-}" a; printf '%s' "$p" > "$TTY"; read -r a < "$TTY" || a=""; printf '%s' "${a:-$d}"; }
ask_secret() { local p="$1" a; printf '%s' "$p" > "$TTY"; read -rs a < "$TTY" || a=""; printf '\n' > "$TTY"; printf '%s' "$a"; }

rand_hex() {  # rand_hex <bytes>  -> lowercase hex, URL-safe (no encoding needed)
  local n="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c "$((n * 2))"
  fi
}

# Download one file from the published repo, keeping any directory it lives in.
# Used for the compose file and, if Tailscale is chosen, the overlay and its serve
# config — a curl-piped install has none of them on disk.
fetch_file() {
  local rel="$1" dir
  dir="$(dirname "$rel")"
  [ "$dir" = "." ] || mkdir -p "$dir"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_RAW/$rel" -o "$rel"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$rel" "$REPO_RAW/$rel"
  else
    return 1
  fi
}

# Read one value out of .env, or nothing if the key is absent.
get_env() { [ -f .env ] && grep "^${1}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

# Set one value in .env, replacing the line if the key is already there and
# appending it if not.
#
# Rewritten through a temp file rather than edited with `sed -i`, because `sed -i`
# takes an argument on BSD/macOS and does not on GNU/Linux — the one-liner that
# works on a NAS silently creates a stray backup file on a Mac, or fails. The temp
# file is created next to .env so the final `mv` is atomic on the same filesystem,
# and under the same umask, so the secret it may hold is never briefly world-readable.
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(umask 077; mktemp ./.env.XXXXXX)"
  if [ -f .env ] && grep -q "^${key}=" .env; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        "${key}="*) printf '%s=%s\n' "$key" "$val" ;;
        *)          printf '%s\n' "$line" ;;
      esac
    done < .env > "$tmp"
  else
    [ -f .env ] && cat .env > "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  mv "$tmp" .env
  chmod 600 .env
}

primary_ip() {
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  elif command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || true
  fi
}

# ── The optional Tailscale question, and everything that answers it ─────────
#
# Asked in section 4 (fresh install) or section 4b (an install that already
# exists), but only ACTED ON in section 7 — after the base app is already up and
# reported healthy.
#
# That split is the whole failure-containment story. Remote access is an optional
# extra bolted onto a working app; a bad auth key must not be able to cost someone
# the notes they could already reach. Doing the base install first, in full, and
# only then attempting the sidecar means containment is structural rather than
# something the error handling has to get right — by the time anything Tailscale
# can fail at happens, the thing that matters is already running.
TS_WANTED=0
TS_AUTHKEY=""

ask_tailscale() {
  echo
  info "Reach your notes from your phone while you're away from home?"
  info "Tailscale puts this machine on a small private network that only your own"
  info "devices can join. Nothing is exposed to the public internet — no port"
  info "forwarding, no dynamic DNS, no certificate to buy."
  local want
  want="$(ask '   Set up secure remote access with Tailscale? [y/N]: ' 'n')"
  case "$want" in
    [yY]*) ;;
    *) return 0 ;;
  esac

  echo
  info "One thing this installer cannot invent for you: an auth key, which is what"
  info "lets this machine join YOUR tailnet and nobody else's."
  info "Generate one at  https://login.tailscale.com/admin/settings/keys"
  info "A single-use key is enough. The node keeps its own identity in a Docker"
  info "volume once it has connected, so the key is not needed a second time."
  # Read without echoing, exactly like the login password above — it is a
  # credential, and it goes straight into the same private .env.
  TS_AUTHKEY="$(ask_secret '   Paste the auth key (or press Enter to skip): ')"
  if [ -z "$TS_AUTHKEY" ]; then
    # Saying yes and then supplying nothing is the same as having said no. No
    # half-written configuration, no overlay, nothing to undo.
    info "No key given — skipping remote access. The base install continues normally."
    return 0
  fi
  TS_WANTED=1
}

echo
bold "Lockpad installer"
echo

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install Docker Desktop (docker.com/get-started) or Docker Engine, then re-run."
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "Docker Compose is not available. Update Docker Desktop, or install the compose plugin."
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and re-run."
info "Docker and Compose detected."

# ── 2. Fetch the compose file if we're not already inside a checkout ─────────
if [ ! -f "$COMPOSE_FILE" ]; then
  info "Downloading $COMPOSE_FILE ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_RAW/$COMPOSE_FILE" -o "$COMPOSE_FILE" || die "Could not download $COMPOSE_FILE."
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$COMPOSE_FILE" "$REPO_RAW/$COMPOSE_FILE" || die "Could not download $COMPOSE_FILE."
  else
    die "Need curl or wget to download the compose file (or run this from a Lockpad checkout)."
  fi
fi

# ── 3. Don't clobber an existing install ─────────────────────────────────────
if [ -f .env ]; then
  warn ".env already exists in $(pwd)."
  keep="$(ask "   Keep it and just (re)start Lockpad? [Y/n] " "Y")"
  case "$keep" in
    [Nn]*) die "Aborting so your existing .env / data is not overwritten. Move it aside first." ;;
    *) info "Keeping existing .env."; SKIP_ENV=1 ;;
  esac
else
  SKIP_ENV=0
fi

# ── 4. Gather the two real choices, generate everything else ─────────────────
if [ "${SKIP_ENV:-0}" -eq 0 ]; then
  echo
  bold "A few questions (press Enter for the recommended default):"
  echo

  # Login password — the only thing standing between a visitor and your notes.
  info "Set a login password for the app. Strongly recommended."
  APP_PASSWORD="$(ask_secret '   Password (leave blank for NO password): ')"
  if [ -n "$APP_PASSWORD" ]; then
    confirm="$(ask_secret '   Confirm password: ')"
    [ "$APP_PASSWORD" = "$confirm" ] || die "Passwords did not match. Re-run the installer."
  else
    warn "No login password set — anyone who can reach this address can read your notes."
  fi

  # Who can reach it.
  echo
  info "Where should Lockpad listen?"
  info "  1) This computer only (http://localhost:5173)  [recommended]"
  info "  2) Everyone on my local network (http://<this-machine-ip>:5173)"
  choice="$(ask '   Choose 1 or 2 [1]: ' '1')"

  ip="$(primary_ip || true)"
  if [ "$choice" = "2" ]; then
    FRONTEND_BIND=""                       # bind 0.0.0.0
    if [ -n "$ip" ]; then
      ACCESS_URL="http://$ip:5173"
      CORS_ORIGINS="http://$ip:5173,http://localhost:5173"
    else
      ACCESS_URL="http://<this-machine-ip>:5173"
      CORS_ORIGINS="http://localhost:5173"
      warn "Couldn't auto-detect this machine's IP. If saving notes fails, add its URL to CORS_ORIGINS in .env."
    fi
  else
    FRONTEND_BIND="127.0.0.1:"
    ACCESS_URL="http://localhost:5173"
    CORS_ORIGINS="http://localhost:5173"
  fi

  # The one combination worth stopping for: reachable from the whole network AND no
  # password. Either alone is a supported, sensible choice — a machine only you can
  # reach does not need a second door, and LAN access is why option 2 exists. Together
  # they mean anyone on the network can read and edit everything, which is worth
  # saying out loud BEFORE the install finishes rather than leaving to be discovered.
  # It informs and moves on; the choice stays the operator's.
  if [ "$choice" = "2" ] && [ -z "$APP_PASSWORD" ]; then
    echo
    warn "Careful: you chose network access AND no password."
    warn "Anyone on your local network will be able to read and edit every unlocked"
    warn "note, with no login at all. That is fine on a network only you use — but if"
    warn "it was not what you meant, answer n and re-run with a password."
    keep="$(ask '   Continue anyway? [y/N]: ' 'n')"
    case "$keep" in
      [yY]*) info "Continuing with network access and no password." ;;
      *) die "Stopped. Re-run ./install.sh and set a password, or choose option 1." ;;
    esac
  fi

  POSTGRES_PASSWORD="$(rand_hex 24)"
  SESSION_SECRET="$(rand_hex 32)"
  DATABASE_URL="postgresql://lockpad:${POSTGRES_PASSWORD}@postgres:5432/lockpad?schema=public"

  umask 077   # .env holds secrets — keep it owner-readable only
  cat > .env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep this file private.

# ── Which version of Lockpad this install runs ──
# Pinned deliberately. Without it Compose falls back to \`latest\`, which is rebuilt
# on every push to the source repository — so your notes app would change underneath
# you whenever someone committed, including in the middle of a working week. Pinned,
# it changes only when you decide. To move to a newer release, edit this line and run
# \`docker compose pull && docker compose up -d\`; the backend applies any new database
# migrations itself on startup.
TAG=${LOCKPAD_VERSION}

# ── Postgres (internal only, never exposed) ──
POSTGRES_USER=lockpad
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=lockpad

# ── Backend ──
DATABASE_URL=${DATABASE_URL}
BACKEND_PORT=4000
LOG_DIR=/var/log/lockpad
CORS_ORIGINS=${CORS_ORIGINS}

# ── App auth ──
APP_PASSWORD=${APP_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}
# true only when served over HTTPS (e.g. Tailscale serve); false for plain HTTP.
COOKIE_SECURE=false

# ── Frontend exposure ──
FRONTEND_PORT=5173
FRONTEND_BIND=${FRONTEND_BIND}
EOF
  info "Wrote .env (secrets generated automatically, permissions 600)."

  # Asked after the questions that shape the base install, because it is an addition
  # to that install rather than part of it. Answering no from here on out is the
  # path every previous version of this script took, unchanged.
  ask_tailscale
else
  # Reuse existing settings for the final message.
  ACCESS_URL="http://localhost:5173"

  # Is this install pinned to a release, or drifting with `latest`?
  #
  # Deliberately only REPORTED, never fixed. Writing TAG here would look like a
  # kindness and could be a downgrade: an install that has been tracking `latest`
  # may already be running code newer than $LOCKPAD_VERSION, and its database may
  # already carry migrations that release does not have. Prisma migrations only run
  # forward, so moving an older backend onto a newer schema is not a supported
  # direction and this script must not do it behind someone's back. Telling them
  # where they stand is useful; choosing for them is not.
  if [ -z "$(get_env TAG)" ]; then
    UNPINNED=1
  fi

  # ── 4b. An install that already exists ────────────────────────────────────
  #
  # Re-running the installer used to offer exactly one thing: keep your .env and
  # restart. Someone who installed before this feature existed had no way to reach
  # the Tailscale option except by hand-following DEPLOY.md — the precise friction
  # this is meant to remove, aimed at the people least likely to be told it is gone.
  #
  # Nothing else about their install is touched. This branch reads .env; it writes
  # to it only if the answer is yes.
  ts_existing_key="$(get_env TS_AUTHKEY)"
  ts_existing_files="$(get_env COMPOSE_FILE)"
  if [ -n "$ts_existing_key" ] || case "$ts_existing_files" in *"$TS_FILE"*) true ;; *) false ;; esac; then
    # Already on. Do not ask again, and do not touch a working configuration.
    info "Secure remote access is already set up — leaving it exactly as it is."
    TS_ALREADY=1
  else
    ask_tailscale
  fi
fi

# ── 5. Pull & start ──────────────────────────────────────────────────────────
#
# If Tailscale is already configured from a previous run, its overlay has to be on
# this command too — otherwise this "just restart it" run would silently take the
# sidecar away, which is the exact footgun DEPLOY.md warns about and the reason
# DC_FILES exists.
if [ "${TS_ALREADY:-0}" -eq 1 ] && [ -f "$TS_FILE" ]; then
  DC_FILES=(-f "$COMPOSE_FILE" -f "$TS_FILE")
fi

echo
bold "Pulling images and starting Lockpad..."
$DC "${DC_FILES[@]}" pull
$DC "${DC_FILES[@]}" up -d

# ── 6. Wait for health, then report ──────────────────────────────────────────
echo
printf '  Waiting for the app to come up'
ok=0
for _ in $(seq 1 30); do
  if $DC "${DC_FILES[@]}" exec -T backend wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    ok=1; break
  fi
  printf '.'; sleep 2
done
echo

# ── 7. Optional: secure remote access, only once the base app is healthy ────
#
# Everything below runs on an app that is already up and answering. If any of it
# fails, the failure is reported as its own thing and the base app is left exactly
# as it was — see the note on TS_WANTED at the top.
TS_URL=""
TS_FAILED=0

enable_tailscale() {
  echo
  bold "Setting up secure remote access..."

  # The overlay and its serve config are two more files a curl-piped install has
  # never seen. Fetch them the same way the compose file was fetched.
  for f in "$TS_FILE" "$TS_SERVE"; do
    if [ ! -f "$f" ]; then
      info "Downloading $f ..."
      fetch_file "$f" || { warn "Could not download $f."; return 1; }
    fi
  done

  # The key goes into the same private, 600-permission .env as every other secret
  # this script handles, and is never printed back.
  set_env TS_AUTHKEY "$TS_AUTHKEY"

  DC_FILES=(-f "$COMPOSE_FILE" -f "$TS_FILE")
  $DC "${DC_FILES[@]}" up -d || return 1

  # Wait for the node to actually join the tailnet. Bounded the same way the base
  # app's health wait is bounded — a clear timeout beats an open-ended hang, and a
  # key that is expired or already used fails HERE rather than looking like success.
  printf '  Waiting for the tailnet node to come up'
  local ts_ok=0 state=""
  for _ in $(seq 1 30); do
    state="$($DC "${DC_FILES[@]}" exec -T tailscale tailscale status --json 2>/dev/null | tr -d ' \n' || true)"
    case "$state" in *'"BackendState":"Running"'*) ts_ok=1; break ;; esac
    printf '.'; sleep 2
  done
  echo
  [ "$ts_ok" -eq 1 ] || return 1

  # The tailnet name is only knowable once the node has connected — it is assigned
  # by Tailscale, not chosen here. Read it back so the final message can print a URL
  # someone can actually open, rather than a placeholder to go and look up.
  local dns
  dns="$(printf '%s' "$state" | grep -o '"DNSName":"[^"]*"' | head -1 | sed 's/.*:"//; s/"$//; s/\.$//')"
  [ -n "$dns" ] && TS_URL="https://$dns" || TS_URL="https://lockpad.<your-tailnet>.ts.net"

  # CORS_ORIGINS is an exact-match allowlist (backend/src/config.ts).
  #
  # Strictly speaking the tailnet address does not need to be in it: nginx serves the
  # page and proxies /api on the same origin, so the browser never makes a
  # cross-origin request at all (DEPLOY.md §9 spells this out). It goes in anyway, for
  # the same reason this script already lists the LAN address — an allowlist entry
  # that is never consulted costs nothing, and the failure it would prevent is one of
  # the hardest kinds to diagnose from the outside.
  #
  # Appended rather than replacing, so the local and LAN URLs this installer just set
  # up keep working. Remote access is an addition, not a move.
  if [ -n "$dns" ]; then
    local cors
    cors="$(get_env CORS_ORIGINS)"
    case ",$cors," in
      *",$TS_URL,"*) ;;
      *) set_env CORS_ORIGINS "${cors:+$cors,}$TS_URL"
         # Only the backend reads CORS_ORIGINS, and only at startup.
         $DC "${DC_FILES[@]}" up -d backend >/dev/null 2>&1 || true ;;
    esac
  fi

  # Written down so a later `docker compose up -d` in this directory carries the
  # overlay without anyone having to remember the second -f. Deliberately the LAST
  # step: pinning a set of files that had failed to come up would hand the user a
  # directory where the plain command no longer works.
  local existing
  existing="$(get_env COMPOSE_FILE)"
  if [ -z "$existing" ]; then
    set_env COMPOSE_FILE "$COMPOSE_FILE:$TS_FILE"
  elif case "$existing" in *"$TS_FILE"*) true ;; *) false ;; esac; then
    : # already lists the overlay
  else
    # Someone has pinned their own set of overlays. Adding to it silently would be
    # overwriting a decision this script did not make, so say what is there and ask.
    echo
    warn "Your .env already pins a compose-file list:"
    info "  COMPOSE_FILE=$existing"
    local addit
    addit="$(ask '   Add the Tailscale overlay to that list? [Y/n]: ' 'Y')"
    case "$addit" in
      [Nn]*) warn "Left as-is. Remember to pass -f $TS_FILE yourself, or remote access will drop off on the next up -d." ;;
      *) set_env COMPOSE_FILE "$existing:$TS_FILE" ;;
    esac
  fi
  return 0
}

if [ "$ok" -eq 1 ] && [ "$TS_WANTED" -eq 1 ]; then
  if enable_tailscale; then
    :
  else
    TS_FAILED=1
    # Clear the key that did not work.
    #
    # Not tidiness — leaving it behind is a trap. The "is remote access already on?"
    # check on the next run keys off TS_AUTHKEY being present, so a failed attempt
    # would leave the installer reporting "already set up" on every future run,
    # never re-asking, and quietly starting the broken sidecar again each time. A
    # key that failed is not configuration; it is a discarded attempt.
    set_env TS_AUTHKEY ""
    # Take the sidecar back out so a failed node is not left retry-looping beside a
    # working app. --remove-orphans is what actually removes it: with only the base
    # file on the command, the tailscale service is now an orphan.
    DC_FILES=(-f "$COMPOSE_FILE")
    $DC "${DC_FILES[@]}" up -d --remove-orphans >/dev/null 2>&1 || true
    echo
    warn "Secure remote access could not be set up."
    warn "The usual cause is an auth key that has expired or was already used —"
    warn "generate a fresh one and re-run this installer to try again."
    # The distinction the user actually needs: this failure is not their app.
    if $DC "${DC_FILES[@]}" exec -T backend wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
      info "Your notes are unaffected — Lockpad itself is running and reachable below."
    else
      warn "Lockpad also stopped responding. Check:  $DC -f $COMPOSE_FILE logs -f"
    fi
  fi
fi

if [ "$ok" -eq 1 ]; then
  echo
  bold "✓ Lockpad is running."
  info "Open:  ${ACCESS_URL:-http://localhost:5173}"
  if [ -n "$TS_URL" ]; then
    info "From anywhere on your tailnet:  $TS_URL"
    echo
    info "Note locking needs HTTPS, so it works on the tailnet address but not on the"
    info "plain http:// one. If you will only ever use the tailnet address, setting"
    info "COOKIE_SECURE=true in .env is a small extra hardening — but it will stop the"
    info "http:// address above from being able to log in, so leave it alone if you use both."
  fi
  echo
  # Printed from DC_FILES rather than the base file alone, so someone who turned
  # remote access on is given commands that keep it on. A copy-pasteable command
  # that quietly drops the sidecar is worse than no command at all.
  FILES_STR="${DC_FILES[*]}"
  info "Useful commands (run them from $(pwd)):"
  info "  $DC $FILES_STR logs -f     # watch logs"
  info "  $DC $FILES_STR down        # stop"
  info "  $DC $FILES_STR pull && $DC $FILES_STR up -d   # re-pull the pinned version"
  echo
  # Said explicitly, because a pinned install makes `pull` look broken. Someone who
  # runs the update command above and sees "up to date" would reasonably conclude the
  # update mechanism has failed, when in fact the pin is doing precisely its job.
  if [ "${UNPINNED:-0}" -eq 1 ]; then
    info "This install is not pinned to a release: it follows the rolling \`latest\` image,"
    info "so it can change whenever new code is published. To pin it, add a line like"
    info "  TAG=$LOCKPAD_VERSION"
    info "to .env and re-run the update command above. Check Settings → About first —"
    info "if it already shows something newer, pin to THAT version rather than going back."
  else
    info "This install is pinned to $LOCKPAD_VERSION, so nothing changes underneath you."
    info "To move to a newer release: edit TAG in .env, then run the update command above."
  fi
  echo
  info "Before updating, export your notes from Settings → Data. Settings → About shows"
  info "which version you are on and links to what changed."
  if [ -z "$TS_URL" ] && [ "$TS_FAILED" -eq 0 ] && [ "${TS_ALREADY:-0}" -eq 0 ]; then
    echo
    info "Want it on your phone too, securely? Re-run this installer and say yes to"
    info "the Tailscale question — it will set it up for you."
  fi
else
  warn "The app didn't report healthy in time. Check logs:"
  info "  $DC ${DC_FILES[*]} logs -f"
fi
