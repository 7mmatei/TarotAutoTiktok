import { readFile } from "node:fs/promises";
import { createDatabase } from "@tarot/db";
import { loadConfig } from "@tarot/config";

const config = loadConfig();
const { pool } = createDatabase(config.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const migrationId of ["0000_initial", "0001_rehydrate", "0002_mvp_runtime", "0003_paid_tiers"]) {
    const applied = await client.query("SELECT id FROM schema_migrations WHERE id = $1", [migrationId]);
    if (applied.rowCount !== 0) { console.log(`Migration ${migrationId} already applied`); continue; }
    const sql = await readFile(new URL(`../../../packages/db/drizzle/${migrationId}.sql`, import.meta.url), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migrationId]);
    await client.query("COMMIT");
    console.log(`Applied migration ${migrationId}`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
