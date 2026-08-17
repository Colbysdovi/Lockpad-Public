# Build the SPA, then serve it as static files with nginx. nginx also proxies
# /api to the backend so the browser only ever talks to one origin (no CORS,
# no cross-origin calls) — which is what tailscale serve fronts.
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# The release this bundle was built from, baked in at BUILD time (same idea as the
# backend's APP_VERSION). CI passes the git tag; a plain `docker compose build`
# leaves the default, so a build-from-source instance says "dev" instead of
# claiming a release it isn't. See docs/RELEASING.md.
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# The shared server body lives in a snippet so the plain-HTTP server and the
# optional TLS server (docker-compose.lan-tls.yml) cannot drift apart.
COPY nginx-app.conf /etc/nginx/snippets/lockpad-app.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
