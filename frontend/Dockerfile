# Build the SPA, then serve it as static files with nginx. nginx also proxies
# /api to the backend so the browser only ever talks to one origin (no CORS,
# no cross-origin calls) — which is what tailscale serve fronts.
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# The release this bundle was built from, baked in at BUILD time (same idea as the
# backend's APP_VERSION). CI passes the git tag verbatim, and that is the only way
# a build gets a bare release number; a build from source is stamped below instead.
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# ── What a BUILD-FROM-SOURCE instance calls itself ───────────────────────────
#
# It used to call itself "dev", full stop, which meant a self-hosted instance
# built from a release tarball had no way to say WHICH release it was built from.
# Settings → About read "Development build (dev)" whether the source was six
# months old or cut an hour ago, so "which version am I on" had no answer short
# of diffing files.
#
# So when no version is passed, derive one from package.json — which is already
# in this build context, already ships inside `git archive`, and is the
# conventional place for it. release.sh keeps it in step with the tag, so this
# updates itself on every deploy instead of being a string someone must remember
# to edit. (That is the whole point: a hand-maintained version is a version that
# goes stale, which is how the public README came to advertise v1.0.0 while
# v1.1.0 was out.)
#
# The `+src` suffix is not decoration. This is a local build of a source tree
# that MIGHT carry uncommitted changes, so it must not be indistinguishable from
# the published artifact of the same number. version.ts still reads it as a
# release — the label becomes "v1.1.1+src · Abomey" — but the suffix says plainly
# where it came from, and a bug report carrying it cannot be mistaken for one
# against the image on GHCR.
#
# A tree with no usable version falls back to "dev" exactly as before.
RUN if [ "$VITE_APP_VERSION" = "dev" ]; then       PKG="$(node -p "require('./package.json').version || ''" 2>/dev/null || true)";       if [ -n "$PKG" ] && [ "$PKG" != "0.0.0" ]; then         export VITE_APP_VERSION="v${PKG}+src";       fi;     fi;     echo "building frontend as VITE_APP_VERSION=$VITE_APP_VERSION" &&     npm run build

FROM nginx:1.27-alpine AS runtime
# The shared server body lives in a snippet so the plain-HTTP server and the
# optional TLS server (docker-compose.lan-tls.yml) cannot drift apart.
COPY nginx-app.conf /etc/nginx/snippets/lockpad-app.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
