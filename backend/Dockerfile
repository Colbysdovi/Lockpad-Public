# Multi-stage build for the Lockpad backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The release this image was built from, baked in at BUILD time so it can never
# drift from the code actually running. CI passes the git tag (e.g. v1.3.0) or,
# off a tag, a short commit marker. A plain `docker compose build` leaves the
# default, which is how a build-from-source instance identifies itself honestly
# rather than claiming to be some release it isn't.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
# Prisma CLI (from the build stage) so migrations can run at startup.
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
EXPOSE 4000
# Apply any pending migrations (idempotent) then start the API.
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
