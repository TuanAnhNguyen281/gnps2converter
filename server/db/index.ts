import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import type { Config } from "../config.js";
export type Query = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values?: unknown[],
) => Promise<pg.QueryResult<T>>;
export interface Connection {
  query: Query;
  release(): void;
}
export interface Database {
  query: Query;
  connect(): Promise<Connection>;
  end(): Promise<void>;
}
export function createDatabase(config: Config): Database {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
  });
  pool.on("error", () => console.error("[database] Connection interrupted"));
  // Expose Drizzle's typed schema for extensions; transactional repositories use parameterized SQL.
  drizzle(pool, { schema });
  return pool;
}
export async function transaction<T>(
  db: Database,
  run: (client: Connection) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
