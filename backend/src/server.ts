// The process entry point: build the app, listen, and shut down cleanly.
//
// Deliberately thin. Everything about HOW the server is assembled lives in app.ts,
// so this file can stay the one place that owns the process lifecycle — which is
// also what makes the app testable, since the tests build an app without ever
// binding a port.
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

const app = buildApp();

async function start() {
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Lockpad backend listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Shut down in order on Ctrl-C or a container stop: stop accepting requests first,
// then close the database pool. Skipping this leaves Postgres holding connections
// open until they time out, which on a small NAS-hosted instance is enough to make
// the next start fail for want of a free slot.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

start();
