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
COMPOSE_FILE="docker-compose.public.yml"

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

primary_ip() {
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  elif command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || true
  fi
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
else
  # Reuse existing settings for the final message.
  ACCESS_URL="http://localhost:5173"
fi

# ── 5. Pull & start ──────────────────────────────────────────────────────────
echo
bold "Pulling images and starting Lockpad..."
$DC -f "$COMPOSE_FILE" pull
$DC -f "$COMPOSE_FILE" up -d

# ── 6. Wait for health, then report ──────────────────────────────────────────
echo
printf '  Waiting for the app to come up'
ok=0
for _ in $(seq 1 30); do
  if $DC -f "$COMPOSE_FILE" exec -T backend wget -qO- http://localhost:4000/api/health >/dev/null 2>&1; then
    ok=1; break
  fi
  printf '.'; sleep 2
done
echo

if [ "$ok" -eq 1 ]; then
  echo
  bold "✓ Lockpad is running."
  info "Open:  ${ACCESS_URL:-http://localhost:5173}"
  echo
  info "Useful commands (run them from $(pwd)):"
  info "  $DC -f $COMPOSE_FILE logs -f     # watch logs"
  info "  $DC -f $COMPOSE_FILE down        # stop"
  info "  $DC -f $COMPOSE_FILE pull && $DC -f $COMPOSE_FILE up -d   # update (migrations run themselves)"
  echo
  info "Before updating, export your notes from Settings → Data. Settings → About shows"
  info "which version you are on and links to what changed."
  echo
  info "Want it on your phone too, securely? See the 'Remote access' section of the README (Tailscale)."
else
  warn "The app didn't report healthy in time. Check logs:"
  info "  $DC -f $COMPOSE_FILE logs -f"
fi
