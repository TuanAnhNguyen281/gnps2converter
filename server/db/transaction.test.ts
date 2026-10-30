import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { transaction, type Database } from "./index.js";

// A pg-like client whose connection the server can drop mid-query.
function fakeDb(dropOn?: string) {
  const client = Object.assign(new EventEmitter(), {
    sql: [] as string[],
    released: undefined as Error | undefined | null,
    async query(sql: string) {
      client.sql.push(sql);
      if (sql === dropOn) {
        const error = new Error("Connection terminated unexpectedly");
        client.emit("error", error);
        throw error;
      }
      return { rows: [] } as any;
    },
    release(error?: Error) {
      client.released = error ?? null;
    },
  });
  return { client, db: { connect: async () => client } as unknown as Database };
}

describe("transaction", () => {
  it("commits and returns the client to the pool", async () => {
    const { client, db } = fakeDb();
    expect(
      await transaction(db, async (c) => (await c.query("SELECT 1"), 7)),
    ).toBe(7);
    expect(client.sql).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(client.released).toBeNull();
    expect(client.listenerCount("error")).toBe(0);
  });
  it("survives a dropped connection and discards the client", async () => {
    const { client, db } = fakeDb("SELECT 1");
    // Without a listener the emitted 'error' would throw out of emit().
    await expect(transaction(db, (c) => c.query("SELECT 1"))).rejects.toThrow(
      "terminated",
    );
    expect(client.sql).toEqual(["BEGIN", "SELECT 1"]);
    expect(client.released).toBeInstanceOf(Error);
    expect(client.listenerCount("error")).toBe(0);
  });
  it("rolls back on an ordinary error", async () => {
    const { client, db } = fakeDb();
    await expect(
      transaction(db, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(client.sql).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.released).toBeNull();
  });
});
