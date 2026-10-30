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
  // pg destroys the client instead of pooling it when given an error.
  release(error?: Error): void;
  on?(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
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
  // The pool only listens on idle clients. Without this, a connection the
  // server drops mid-transaction (Neon does) is an unhandled 'error' event
  // that kills the process; the pending query rejects on its own.
  let broken: Error | undefined;
  const onError = (error: Error) => {
    broken = error;
    console.error("[database] Connection interrupted during transaction");
  };
  client.on?.("error", onError);
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (!broken)
      await client.query("ROLLBACK").catch((e: Error) => (broken = e));
    throw error;
  } finally {
    client.off?.("error", onError);
    // A broken client is destroyed instead of going back to the pool.
    client.release(broken);
  }
}
