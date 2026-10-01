// Isolated local QA only. In-memory DB and fake AI, never reads the deployed database.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type pg from "pg";
import type { Database, Query } from "../server/db/index.js";
import { readConfig } from "../server/config.js";
import { createApp } from "../server/app.js";
const sql = new PGlite();
for (const migration of [
  "0001_accounts_reports.sql",
  "0002_research_ai.sql",
  "0003_ai_model_pricing.sql",
])
  await sql.exec(
    await readFile(
      new URL(`../migrations/${migration}`, import.meta.url),
      "utf8",
    ),
  );
let tail = Promise.resolve();
const lock = async () => {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const previous = tail;
  tail = next;
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
const db: Database = {
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
  end: async () => sql.close(),
};
const config = readConfig({
  APP_ORIGIN: "http://localhost:5193",
  SESSION_SECRET: "local-qa-only-secret-32-characters-long",
  AI_ENCRYPTION_KEY: "ef".repeat(32),
  AI_ALLOWED_HOSTS: "example.com",
});
const app = createApp(
  config,
  db,
  {
    upload: async () => ({ assetId: "fake", version: "1" }),
    download: async () => Buffer.alloc(0),
    destroy: async () => {},
  },
  async (url, _key, body, signal) => {
    if (url.pathname.endsWith("/models"))
      return Response.json({ data: [{ id: "demo-model" }] });
    if ((body as any).messages.some((m: any) => m.content === "Reply with OK."))
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "OK" } }],
      });
    const content =
      "Theo dữ liệu mẫu, báo cáo có 3 hợp chất: Compound A, Compound B và Compound C. Sai số ppm lớn nhất là 15. Đây là kết quả kiểm tra với provider giả lập; không phải phân tích AI thực.";
    if ((body as any).stream) {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of content.match(/.{1,15}/gu) ?? []) {
              if (signal.aborted) {
                controller.error(new Error("aborted"));
                return;
              }
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
                ),
              );
              await new Promise((r) => setTimeout(r, 60));
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 40 } })}\n\ndata: [DONE]\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    });
  },
);
const user = randomUUID();
await db.query(
  "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)",
  [
    user,
    "research-qa@example.test",
    "Research QA",
    await argon2.hash("local-qa-password-123"),
  ],
);
const base = {
  selected: true,
  sourceTsvRow: 1,
  sourceXlsxRow: 1,
  adduct: "M+H",
  mzTsv: 100,
  mzData: 100,
  rtTsv: 1,
  rtData: 1,
  rtDisplay: "1",
  deltaDa: 0,
  deltaRt: 0,
  candidateCount: 1,
  molecularFormula: "C6H12O6",
  fragments: "50;75",
  reportedMzErrorPpm: null,
  sourceMetadata: {},
  status: "matched",
};
const rows = ["A", "B", "C"].map((name, i) => ({
  ...base,
  id: `row-${name}`,
  compoundName: `Compound ${name}`,
  deltaPpm: [1, 5, 15][i],
}));
const result = {
  source: "files",
  rows,
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
    tsvRows: 3,
    dataRows: 3,
    matched: 3,
    unmatched: 0,
    invalidTsv: 0,
    invalidData: 0,
  },
  parameters: { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.5 },
};
await app.reports!.create(user, "Báo cáo nghiên cứu mẫu", result, randomUUID());
const server = app.app.listen(8789, "127.0.0.1", () =>
  console.log(
    "Isolated Research QA: http://localhost:5193 | research-qa@example.test | local-qa-password-123 | fake AI only",
  ),
);
process.once("SIGINT", () => server.close(() => void db.end()));
