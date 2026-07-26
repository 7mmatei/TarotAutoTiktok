import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
export function createDatabase(databaseUrl: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
