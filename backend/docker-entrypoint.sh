#!/bin/sh
# Apply pending DB migrations (idempotent — `migrate deploy` only runs new ones),
# then start the API. Runs the Prisma CLI directly (no dev deps needed).
set -e
node node_modules/prisma/build/index.js migrate deploy
exec node dist/server.js
