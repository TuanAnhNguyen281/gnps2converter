import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url)
  throw new Error("Cần DATABASE_URL hoặc MIGRATION_DATABASE_URL để migrate.");
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(2948787)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = new URL("../../migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(name, dir), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum)
        throw new Error(`Migration đã chạy bị thay đổi: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
