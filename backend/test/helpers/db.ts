// A real Postgres, booted from scratch for a test run and thrown away afterwards.
//
// `embedded-postgres` unpacks an actual Postgres binary into a temp directory and
// starts it on a free port, so tests get genuine database behaviour with no
// installed service, no shared state between runs, and nothing left behind. Each
// test file that needs a database calls startTestDb() once and gets its own.
//
// The migrations are applied from prisma/migrations in timestamp order — the same
// files and the same order as `prisma migrate deploy` in production. That matters
// more than it looks: several behaviours the app depends on are defined in raw SQL
// inside those migrations (the generated full-text search column, the referential
// actions) and would simply not exist in a schema created any other way.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pkg from "pg";

// pg is CommonJS; destructure Client for the ESM interop path.
const { Client } = pkg;

const here = fileURLToPath(new URL(".", import.meta.url));
const migrationsDir = join(here, "../../prisma/migrations");
// Apply every migration in timestamp order, exactly like `prisma migrate deploy`.
const migrationSql = readdirSync(migrationsDir)
  .filter((d) => /^\d/.test(d))
  .sort()
  .map((d) => readFileSync(join(migrationsDir, d, "migration.sql"), "utf8"))
  .join("\n");

export interface TestDb {
  url: string;
  pg: EmbeddedPostgres;
  dataDir: string;
  stop: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const dataDir = mkdtempSync(join(tmpdir(), "lockpad-pg-"));
  // Randomize the port so concurrent/leftover instances don't collide.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "lockpad",
    password: "test",
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("lockpad");

  // Connect directly to the `lockpad` database (getPgClient targets the default
  // db, which is not where Prisma reads from) and apply the migration there.
  const url = `postgresql://lockpad:test@localhost:${port}/lockpad?schema=public`;
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(migrationSql);
  await client.end();
  return {
    url,
    pg,
    dataDir,
    stop: async () => {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
