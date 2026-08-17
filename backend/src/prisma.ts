// The one database client for the whole process.
//
// Every module imports THIS instance rather than constructing its own. Each
// PrismaClient opens its own connection pool, so a second one is not just wasteful
// — on a small self-hosted Postgres it is how you run out of connections and start
// refusing requests. One client, one pool, closed cleanly on shutdown (server.ts).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
