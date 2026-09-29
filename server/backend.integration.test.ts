import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import supertest from "supertest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import type { Database, Query } from "./db/index.js";
import { transaction } from "./db/index.js";
import type { MediaProvider, MediaInput } from "./media/provider.js";
import { validateFile } from "./media/provider.js";
import { validCsrf } from "./auth/routes.js";

const config = readConfig({
  APP_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "test-only-secret-32-characters-long",
  MAX_REPORTS_PER_USER: "20",
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcO7WQAAAABJRU5ErkJggg==",
  "base64",
);
const row = {
  id: "source-row",
  selected: true,
  sourceTsvRow: 1,
  sourceXlsxRow: 1,
  compoundName: "Compound A",
  adduct: "M+H",
  mzTsv: 100,
  mzData: 100,
  rtTsv: 1,
  rtData: 1,
  rtDisplay: "1",
  deltaDa: 0,
  deltaPpm: 0,
  deltaRt: 0,
  candidateCount: 1,
  molecularFormula: "C6H12O6",
  fragments: "50; 75",
  reportedMzErrorPpm: null,
  sourceMetadata: { "#Scan#": 1 },
  status: "matched" as const,
};
const result = {
  source: "files",
  rows: [row],
  mapping: {
    compoundName: "name",
    adduct: "adduct",
    precursorMz: "mz",
    formula: "formula",
    reportedPpm: "ppm",
    fragments: "fragments",
    excelCompoundName: "name",
    excelRt: "rt",
  },
  tsvHeaders: ["name"],
  excelHeaders: ["name"],
  sheets: ["Sheet1"],
  summary: {
    tsvRows: 1,
    dataRows: 1,
    matched: 1,
    unmatched: 0,
    invalidTsv: 0,
    invalidData: 0,
  },
  parameters: { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.5 },
};
let sql: PGlite,
  db: Database,
  app: ReturnType<typeof createApp>,
  a: ReturnType<typeof supertest.agent>,
  b: ReturnType<typeof supertest.agent>,
  csrfA: string,
  csrfB: string,
  idA: string,
  idB: string,
  cookieA: string;
const stored = new Map<string, Buffer>();
let failUpload = false,
  failDelete = false;
afterEach(() => vi.unstubAllGlobals());
const provider: MediaProvider = {
  async upload(id, input) {
    if (failUpload) throw new Error("Simulated network failure");
    stored.set(id, input.bytes);
    return { assetId: id, version: "1" };
  },
  async download(asset) {
    const bytes = stored.get(asset.public_id);
    if (!bytes) throw new Error("Missing fake cloud asset");
    return bytes;
  },
  async destroy(asset) {
    if (failDelete) throw new Error("Simulated delete failure");
    stored.delete(asset.public_id);
  },
};
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(
    await readFile(
      new URL("../migrations/0001_accounts_reports.sql", import.meta.url),
      "utf8",
    ),
  );
  let tail = Promise.resolve();
  const lock = async () => {
    let release!: () => void;
    const current = new Promise<void>((r) => {
      release = r;
    });
    const previous = tail;
    tail = current;
    await previous;
    return release;
  };
  const query: Query = async <T extends pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => {
    const r = await sql.query<T>(text, values);
    return {
      rows: r.rows,
      rowCount: r.affectedRows || r.rows.length,
      fields: [],
      command: "",
      oid: 0,
    } as pg.QueryResult<T>;
  };
  db = {
    query: async (text, values) => {
      const release = await lock();
      try {
        return await query(text, values);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await lock();
      return { query, release };
    },
    end: async () => {
      await sql.close();
    },
  };
  app = createApp(config, db, provider);
  a = supertest.agent(app.app);
  b = supertest.agent(app.app);
  const initA = await a.get("/api/auth/csrf");
  csrfA = initA.body.csrf;
  const regA = await a
    .post("/api/auth/register")
    .set("X-CSRF-Token", csrfA)
    .send({
      email: "  A@example.com ",
      password: "valid-password-123",
      displayName: "Tài khoản A",
    });
  expect(regA.status).toBe(201);
  csrfA = regA.body.csrf;
  idA = regA.body.user.id;
  cookieA = (regA.headers["set-cookie"] as unknown as string[])
    .map((v) => v.split(";")[0])
    .join("; ");
  const initB = await b.get("/api/auth/csrf");
  csrfB = initB.body.csrf;
  const regB = await b
    .post("/api/auth/register")
    .set("X-CSRF-Token", csrfB)
    .send({
      email: "b@example.com",
      password: "valid-password-123",
      displayName: "Tài khoản B",
    });
  expect(regB.status).toBe(201);
  csrfB = regB.body.csrf;
  idB = regB.body.user.id;
}, 60000);
afterAll(async () => {
  await db?.end();
});
describe("PostgreSQL-backed accounts, reports and assets", () => {
  it("fails closed without configuration; protects multipart before parsing; CSRF and origin validation", async () => {
    expect(
      (await supertest(createApp(readConfig({})).app).get("/api/health"))
        .status,
    ).toBe(200);
    expect(
      (await supertest(createApp(readConfig({})).app).get("/api/auth/csrf"))
        .status,
    ).toBe(503);
    expect((await supertest(app.app).post("/api/analyze")).status).toBe(403);
    expect(
      (await a.post("/api/reports").send({ title: "x", result })).status,
    ).toBe(403);
    expect(
      (
        await a
          .post("/api/reports")
          .set("X-CSRF-Token", csrfA)
          .set("Origin", "https://evil.example")
          .send({ title: "x", result })
      ).status,
    ).toBe(403);
    expect(validCsrf(csrfA, "short")).toBe(false);
  });
  it("normalizes email, hashes password and persists sessions across app instances", async () => {
    const u = (await db.query("SELECT * FROM users WHERE id=$1", [idA]))
      .rows[0];
    expect(u.email).toBe("a@example.com");
    expect(u.password_hash).toContain("$argon2id$");
    expect(u.password_hash).not.toContain("valid-password");
    const me = await a.get("/api/auth/me");
    expect(me.body.user.id).toBe(idA);
    expect(me.body.user.password_hash).toBeUndefined();
    const sid = (
      await db.query("SELECT sid FROM sessions WHERE sess->>'userId'=$1", [idA])
    ).rows[0].sid;
    expect(sid).toBeTruthy();
    const cookie = (await a.get("/api/auth/csrf")).headers["set-cookie"];
    // A new app uses the same persistent store; the stored session remains valid.
    const session = (
      await db.query("SELECT sess FROM sessions WHERE sid=$1", [sid])
    ).rows[0].sess;
    expect(session.userId).toBe(idA);
    expect(cookie).toBeUndefined();
    expect(
      (
        await supertest(createApp(config, db, provider).app)
          .get("/api/auth/me")
          .set("Cookie", cookieA)
      ).body.user.id,
    ).toBe(idA);
  });
  it("streams GNPS import, PostgreSQL and Cloudinary progress while retaining JSON mode and idempotent replay", async () => {
    const task = "2515573ac8c24ec8b85f553aad9b440e";
    const done = '<table><tr><td>Description</td><td>Progress test</td></tr><tr><td>Status</td><td>DONE</td></tr></table>';
    const library = JSON.stringify([{ "#Scan#": "1", Compound_Name: "Example" }]);
    const graph = "<graphml><graph><node id=\"1\"/></graph></graphml>";
    const mockGnps = () => vi.fn()
      .mockResolvedValueOnce(new Response(done))
      .mockResolvedValueOnce(new Response(library))
      .mockResolvedValueOnce(new Response(graph));
    const key = randomUUID();
    vi.stubGlobal("fetch", mockGnps());
    const streamed = await a
      .post("/api/gnps-task/import?progress=stream")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", key)
      .send({ url: `https://gnps2.org/status?task=${task}` })
      .buffer(true)
      .parse((incoming, callback) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () => callback(null, body));
      });
    expect(streamed.status).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    const body = streamed.body as string;
    const events = body.trim().split(/\r?\n\r?\n/).map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : undefined };
    });
    const progress = events.filter((item) => item.event === "progress").map((item) => item.data);
    const imported = events.find((item) => item.event === "result")?.data;
    expect(progress.some((item) => item.stage === "matches" && item.current === 1)).toBe(true);
    expect(progress.some((item) => item.stage === "database" && item.outcome === "success")).toBe(true);
    expect(progress.some((item) => item.stage === "assets" && item.title.includes("Cloudinary"))).toBe(true);
    expect(progress.at(-1)).toMatchObject({ stage: "complete", outcome: "success" });
    expect(imported.reportId).toBeTruthy();
    expect(imported.mediaStatus).toBe("ready");

    const noFetch = vi.fn(() => Promise.reject(new Error("Idempotency replay should not fetch GNPS")));
    vi.stubGlobal("fetch", noFetch);
    const replay = await a
      .post("/api/gnps-task/import?progress=stream")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", key)
      .send({ url: `https://gnps2.org/status?task=${task}` })
      .buffer(true)
      .parse((incoming, callback) => {
        let responseBody = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (responseBody += chunk));
        incoming.on("end", () => callback(null, responseBody));
      });
    expect(noFetch).not.toHaveBeenCalled();
    const replayEvents = (replay.body as string).trim().split(/\r?\n\r?\n/);
    expect(replayEvents[0]).toContain('"stage":"complete"');
    expect(replayEvents.at(-1)).toContain(imported.reportId);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(done.replace("DONE", "RUNNING"))));
    const failedTask = await a
      .post("/api/gnps-task/import?progress=stream")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", randomUUID())
      .send({ url: `https://gnps2.org/status?task=${task}` })
      .buffer(true)
      .parse((incoming, callback) => {
        let responseBody = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (responseBody += chunk));
        incoming.on("end", () => callback(null, responseBody));
      });
    expect((failedTask.body as string)).toContain('event: error');
    expect((failedTask.body as string)).toContain('"code":"GNPS_TASK_NOT_DONE"');

    vi.stubGlobal("fetch", mockGnps());
    const legacyJson = await a
      .post("/api/gnps-task/import")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", randomUUID())
      .send({ url: `https://gnps2.org/status?task=${task}` });
    expect(legacyJson.headers["content-type"]).toContain("application/json");
    expect(legacyJson.body.reportId).toBeTruthy();

    failUpload = true;
    const mediaProgress: Array<{ stage: string; outcome?: string; failed?: number }> = [];
    let partialReport: Awaited<ReturnType<NonNullable<typeof app.reports>["create"]>>;
    try {
      partialReport = await app.reports!.create(
        idA,
        "Partial media progress",
        result,
        randomUUID(),
        undefined,
        [{ name: "retry.tsv", kind: "source_tsv", mime: "text/tab-separated-values", bytes: Buffer.from("name\\tmz\\nA\\t1") }],
        (event) => mediaProgress.push(event),
      );
    } finally {
      failUpload = false;
    }
    expect(partialReport!.mediaStatus).toBe("failed");
    expect(partialReport!.saveWarning).toBeTruthy();
    expect(mediaProgress.some((event) => event.stage === "assets" && event.outcome === "partial" && event.failed === 1)).toBe(true);
  });
  it("creates idempotently, isolates list/read/update/delete/export/assets and saves revisions", async () => {
    const key = randomUUID();
    const created = await a
      .post("/api/reports")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", key)
      .send({ title: "Báo cáo riêng", result });
    expect(created.status).toBe(201);
    const id = created.body.reportId;
    expect(typeof created.body.updatedAt).toBe("string");
    expect(Date.parse(created.body.updatedAt)).not.toBeNaN();
    const duplicate = await a
      .post("/api/reports")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", key)
      .send({ title: "ignored", result });
    expect(duplicate.body.reportId).toBe(id);
    expect((await b.get(`/api/reports/${id}`)).status).toBe(404);
    expect((await b.get("/api/reports")).body.items).toHaveLength(0);
    expect(
      (
        await b
          .patch(`/api/reports/${id}`)
          .set("X-CSRF-Token", csrfB)
          .send({ title: "hack", result, revision: 1 })
      ).status,
    ).toBe(404);
    expect(
      (await b.delete(`/api/reports/${id}`).set("X-CSRF-Token", csrfB)).status,
    ).toBe(404);
    expect(
      (
        await b
          .post(`/api/reports/${id}/export/xlsx`)
          .set("X-CSRF-Token", csrfB)
          .send({ revision: 1 })
      ).status,
    ).toBe(404);
    expect((await b.get(`/api/reports/${id}/assets`)).status).toBe(404);
    const update = await a
      .patch(`/api/reports/${id}`)
      .set("X-CSRF-Token", csrfA)
      .send({
        title: "Đã sửa",
        result: {
          ...result,
          rows: [{ ...row, selected: false, rtDisplay: "2,5" }],
        },
        revision: 1,
      });
    expect(update.body.revision).toBe(2);
    expect(typeof update.body.updatedAt).toBe("string");
    expect(Date.parse(update.body.updatedAt)).not.toBeNaN();
    const conflict = await a
      .patch(`/api/reports/${id}`)
      .set("X-CSRF-Token", csrfA)
      .send({ title: "old", result, revision: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("REVISION_CONFLICT");
    const reopened = await a.get(`/api/reports/${id}`);
    expect(reopened.body.title).toBe("Đã sửa");
    expect(typeof reopened.body.updatedAt).toBe("string");
    expect(Date.parse(reopened.body.updatedAt)).not.toBeNaN();
    expect(reopened.body.rows[0].rtDisplay).toBe("2,5");
    expect(reopened.body.rows[0].selected).toBe(false);
    expect(
      (await a.get("/api/reports?search=Đã")).body.items.some(
        (r: { id: string }) => r.id === id,
      ),
    ).toBe(true);
  });
  it("deduplicates the same image across rows and keeps raw bytes; enforces asset ownership", async () => {
    const image = `data:image/png;base64,${png.toString("base64")}`;
    const created = await app.reports!.create(
      idA,
      "Ảnh/file",
      {
        ...result,
        rows: [
          { ...row, structureData: image },
          { ...row, id: "another-row", structureData: image },
        ],
      },
      randomUUID(),
      undefined,
      [
        {
          name: "source.tsv",
          kind: "source_tsv",
          bytes: Buffer.from("name\tmz\nA\t100"),
          mime: "text/tab-separated-values",
        },
      ],
    );
    expect(
      created.rows.every((r) => r.structureData?.startsWith("/api/reports/")),
    ).toBe(true);
    const assets = await app.media!.list(idA, created.reportId);
    expect(assets.filter((a) => a.kind === "structure")).toHaveLength(2);
    expect(
      new Set(assets.filter((a) => a.kind === "structure").map((a) => a.id))
        .size,
    ).toBe(1);
    const file = assets.find((a) => a.kind === "source_tsv")!;
    expect(
      (
        await app.media!.download(idA, created.reportId, file.id)
      ).bytes.toString(),
    ).toBe("name\tmz\nA\t100");
    expect(
      (
        await b.get(
          `/api/reports/${created.reportId}/assets/${file.id}/download`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await a.get(
          `/api/reports/${created.reportId}/assets/${file.id}/preview`,
        )
      ).body.columns,
    ).toEqual(["name", "mz"]);
    await app.reports!.update(
      idA,
      created.reportId,
      "Ảnh đã xóa",
      { ...result, rows: [row] },
      1,
    );
    expect(
      (await app.reports!.get(idA, created.reportId)).rows[0].structureData,
    ).toBeUndefined();
  });
  it("analyzes source files, archives exact bytes and recovers sources after result-only save", async () => {
    const originalTsv = await readFile(
        new URL("../samples/GNPS.demo.tsv", import.meta.url),
      ),
      xlsx = await readFile(
        new URL("../samples/Data.demo.xlsx", import.meta.url),
      );
    const response = await a
      .post("/api/analyze")
      .set("X-CSRF-Token", csrfA)
      .set("Idempotency-Key", randomUUID())
      .field("title", "Phân tích demo")
      .attach("tsv", originalTsv, "demo.tsv")
      .attach("xlsx", xlsx, "demo.xlsx");
    expect(response.status).toBe(200);
    expect(response.body.reportId).toBeTruthy();
    expect(response.body.rows.length).toBeGreaterThan(0);
    const files = await app.media!.list(idA, response.body.reportId);
    expect(files.map((f) => f.kind)).toEqual(["source_tsv", "source_xlsx"]);
    expect(
      (
        await app.media!.download(idA, response.body.reportId, files[0].id)
      ).bytes.equals(originalTsv),
    ).toBe(true);
    const fallback = await app.reports!.create(
      idA,
      "Recovered",
      result,
      randomUUID(),
    );
    const attach = await a
      .post(`/api/reports/${fallback.reportId}/assets`)
      .set("X-CSRF-Token", csrfA)
      .field("kind", "source_tsv")
      .attach("file", originalTsv, "recovered.tsv");
    expect(attach.status).toBe(200);
    expect(
      (await app.media!.list(idA, fallback.reportId)).some(
        (f) => f.kind === "source_tsv",
      ),
    ).toBe(true);
  });
  it("serializes optimistic updates and avoids double-counting simultaneous quota reservations", async () => {
    const report = await app.reports!.create(
      idA,
      "Concurrent",
      result,
      randomUUID(),
    );
    const updates = await Promise.allSettled([
      app.reports!.update(idA, report.reportId, "first", result, 1),
      app.reports!.update(idA, report.reportId, "second", result, 1),
    ]);
    expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await app.reports!.get(idA, report.reportId)).revision).toBe(2);
    const before = Number(
      (await db.query("SELECT cloud_bytes FROM users WHERE id=$1", [idB]))
        .rows[0].cloud_bytes,
    );
    const limited = createApp(
        { ...config, maxCloudBytes: before + 5 },
        db,
        provider,
      ),
      other = await limited.reports!.create(
        idB,
        "Media quota",
        result,
        randomUUID(),
      );
    const inputs: MediaInput[] = [
      {
        name: "quota1.tsv",
        kind: "source_tsv",
        bytes: Buffer.from("x\ty\n"),
        mime: "text/plain",
      },
      {
        name: "quota2.tsv",
        kind: "source_tsv",
        bytes: Buffer.from("a\tb\n"),
        mime: "text/plain",
      },
    ];
    const reservations = await Promise.allSettled(
      inputs.map((i) => limited.media!.attach(idB, other.reportId, i)),
    );
    expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      Number(
        (await db.query("SELECT cloud_bytes FROM users WHERE id=$1", [idB]))
          .rows[0].cloud_bytes,
      ) - before,
    ).toBe(4);
  });
  it("retains failed uploads and reservations, retries identical files, retries cloud deletes without losing ownership", async () => {
    failUpload = true;
    const input: MediaInput = {
      name: "failed.tsv",
      kind: "source_tsv",
      bytes: Buffer.from("name\tmz\nRetry\t99"),
      mime: "text/tab-separated-values",
    };
    const created = await app.reports!.create(
      idA,
      "Retry",
      result,
      randomUUID(),
      undefined,
      [input],
    );
    expect(created.mediaStatus).toBe("failed");
    const asset = (await app.media!.list(idA, created.reportId))[0];
    expect(asset.state).toBe("failed");
    const usage = Number(
      (await db.query("SELECT cloud_bytes FROM users WHERE id=$1", [idA]))
        .rows[0].cloud_bytes,
    );
    failUpload = false;
    await app.reports!.persistMedia(idA, created.reportId, [], [input]);
    expect((await app.media!.get(idA, created.reportId, asset.id)).state).toBe(
      "ready",
    );
    expect(
      Number(
        (await db.query("SELECT cloud_bytes FROM users WHERE id=$1", [idA]))
          .rows[0].cloud_bytes,
      ),
    ).toBe(usage);
    await app.reports!.remove(idA, created.reportId);
    failDelete = true;
    await app.media!.cleanup();
    expect(
      (await db.query("SELECT state FROM media_assets WHERE id=$1", [asset.id]))
        .rows[0].state,
    ).toBe("deleting");
    failDelete = false;
    await db.query(
      "UPDATE media_assets SET next_attempt_at=now() WHERE id=$1",
      [asset.id],
    );
    await app.media!.cleanup();
    expect(
      (await db.query("SELECT state FROM media_assets WHERE id=$1", [asset.id]))
        .rows[0].state,
    ).toBe("deleted");
  });
  it("generates and archives XLSX/DOCX from the saved revision, not client-supplied rows", async () => {
    const created = await app.reports!.create(
      idA,
      "Export",
      result,
      randomUUID(),
    );
    for (const ext of ["xlsx", "docx"]) {
      const response = await a
        .post(`/api/reports/${created.reportId}/export/${ext}`)
        .set("X-CSRF-Token", csrfA)
        .send({ revision: 1, rows: [{ compoundName: "tampered" }] });
      expect(response.status).toBe(200);
      expect(response.headers["x-archive-status"]).toBe("saved");
    }
    const assets = await app.media!.list(idA, created.reportId);
    expect(assets.map((a) => a.kind)).toContain("export_docx");
    expect(assets.map((a) => a.kind)).toContain("export_xlsx");
  });
  it("rejects invalid payloads/unsafe files; rolls back SQL failure and enforces quotas", async () => {
    const bad = await a
      .post("/api/reports")
      .set("X-CSRF-Token", csrfA)
      .send({ title: "bad", result: { ...result, rows: [row, row] } });
    expect(bad.status).toBe(400);
    await expect(
      validateFile(
        {
          name: "bad.graphml",
          kind: "gnps_graphml",
          bytes: Buffer.from("<!DOCTYPE root><graphml/>"),
          mime: "application/xml",
        },
        config,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateFile(
        {
          name: "bad.xlsx",
          kind: "source_xlsx",
          bytes: Buffer.from("not OOXML"),
          mime: "application/octet-stream",
        },
        config,
      ),
    ).rejects.toBeTruthy();
    await expect(
      validateFile(
        {
          name: "huge.tsv",
          kind: "source_tsv",
          bytes: Buffer.alloc(config.maxFileBytes + 1),
          mime: "text/plain",
        },
        config,
      ),
    ).rejects.toMatchObject({ status: 413 });
    const email = "rollback@example.com";
    await expect(
      transaction(db, async (c) => {
        await c.query(
          "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",
          [randomUUID(), email, "rollback"],
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await db.query("SELECT id FROM users WHERE email=$1", [email])).rowCount,
    ).toBe(0);
    const count = Number(
      (await db.query("SELECT count(*) FROM reports WHERE owner_id=$1", [idB]))
        .rows[0].count,
    );
    const tiny = createApp(
      { ...config, maxReports: count, maxCloudBytes: 1 },
      db,
      provider,
    );
    await expect(
      tiny.reports!.create(idB, "Two", result, randomUUID()),
    ).rejects.toMatchObject({ code: "REPORT_QUOTA" });
  });
  it("Google is explicitly unavailable without credentials; invalid callback never signs in", async () => {
    expect((await a.get("/api/auth/google")).status).toBe(503);
    expect(
      (
        await supertest(app.app).get(
          "/api/auth/google/callback?state=evil&code=evil",
        )
      ).status,
    ).toBe(400);
  });
  it("changes password, revokes old sessions and rejects resurrected sessions; logout destroys current session", async () => {
    const other = supertest.agent(app.app),
      init = await other.get("/api/auth/csrf");
    const login = await other
      .post("/api/auth/login")
      .set("X-CSRF-Token", init.body.csrf)
      .send({ email: "a@example.com", password: "valid-password-123" });
    expect(login.status).toBe(200);
    const old = (
      await db.query("SELECT * FROM sessions WHERE sess->>'userId'=$1", [idA])
    ).rows;
    const change = await a
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrfA)
      .send({
        oldPassword: "valid-password-123",
        newPassword: "new-password-valid-123",
      });
    expect(change.status).toBe(200);
    csrfA = change.body.csrf;
    for (const s of old)
      await db.query(
        "INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT(sid) DO NOTHING",
        [s.sid, JSON.stringify(s.sess), s.expire],
      );
    expect((await other.get("/api/auth/me")).status).toBe(401);
    expect((await a.get("/api/auth/me")).status).toBe(200);
    expect(
      (await a.post("/api/auth/logout").set("X-CSRF-Token", csrfA)).status,
    ).toBe(204);
    expect((await a.get("/api/auth/me")).status).toBe(401);
  });
});
