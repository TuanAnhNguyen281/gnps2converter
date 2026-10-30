import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import supertest from "supertest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import type pg from "pg";
import type { Database, Query } from "../db/index.js";
import { readConfig } from "../config.js";
import { createApp } from "../app.js";
import type { ProviderTransport } from "./provider.js";

const config = readConfig({
  APP_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "test-only-secret-32-characters-long",
  AI_ENCRYPTION_KEY: "ab".repeat(32),
  AI_ALLOWED_HOSTS: "example.com",
  // finish() polls request state; the default per-minute limit is for real clients.
  API_RATE_LIMIT: "10000",
  ADMIN_EMAILS: "ai-a@example.com",
});
let sql: PGlite,
  db: Database,
  app: ReturnType<typeof createApp>,
  a: ReturnType<typeof supertest.agent>,
  b: ReturnType<typeof supertest.agent>,
  csrfA: string,
  csrfB: string,
  userA: string,
  projectId: string,
  otherProject: string,
  sessionId: string,
  conversationId: string,
  providerId: string,
  reportId: string,
  otherReport: string;
let mode:
    | "success"
    | "failure"
    | "tool"
    | "wait"
    | "stream"
    | "streamTool"
    | "truncated"
    | "streamTruncated"
    | "noStreamOptions"
    | "lookup"
    | "unknown" = "success",
  calls = 0,
  lookups: string[] = [],
  captured: any[] = [];
const transport: ProviderTransport = async (url, _key, body, signal) => {
  if (mode === "unknown")
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: "Usage unavailable." } },
      ],
    });
  if (url.pathname.endsWith("/models"))
    return Response.json({ data: [{ id: "test-model" }] });
  calls++;
  captured.push(body);
  if (mode === "failure") return new Response("", { status: 429 });
  const sse = (chunks: unknown[]) =>
    new Response(
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  if (
    mode === "lookup" &&
    !(body as any).messages.some((m: any) => m.role === "tool")
  )
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                id: "lk",
                type: "function",
                function: {
                  name: "lookup_compound",
                  arguments: '{"rowId":"R1-1"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  if ((body as any).tools?.[0]?.function?.name === "ping")
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                id: "p1",
                type: "function",
                function: { name: "ping", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
  if (mode === "noStreamOptions" && (body as any).stream_options)
    return new Response("{}", { status: 400 });
  if (
    mode === "noStreamOptions" ||
    ((body as any).stream && mode === "success")
  )
    return sse([
      { choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    ]);
  if (mode === "truncated")
    return Response.json({
      choices: [{ finish_reason: "length", message: { content: "Phần đầu" } }],
      usage: { prompt_tokens: 20, completion_tokens: 32 },
    });
  if (mode === "streamTruncated")
    return sse([
      { choices: [{ delta: { content: "Phần " } }] },
      { choices: [{ delta: { content: "đầu" }, finish_reason: "length" }] },
    ]);
  if (mode === "wait")
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error("abort"));
      else
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        });
    });
  if (mode === "stream")
    return new Response(
      'data: {"choices":[{"delta":{"content":"Trả lời "}}]}\n\ndata: {"choices":[{"delta":{"content":"stream"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  if (mode === "streamTool") {
    const toolRound = !(body as any).messages.some(
      (m: any) => m.role === "tool",
    );
    const chunks = toolRound
      ? [
          { choices: [{ delta: { content: "Đang tra cứu" } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-s",
                      function: {
                        name: "query_report_rows",
                        arguments: '{"reportId":"R1",',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: '"minAbsolutePpm":5}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
        ]
      : [
          { choices: [{ delta: { content: "Dòng lệch ppm: [R1-1]" } }] },
          {
            choices: [
              { delta: { content: ", sai [R1-9]" }, finish_reason: "stop" },
            ],
          },
          { choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } },
        ];
    return new Response(
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  if (
    mode === "tool" &&
    !(body as any).messages.some((m: any) => m.role === "tool")
  )
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "query_report_rows",
                  arguments: JSON.stringify({ reportId, minAbsolutePpm: 5 }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { content: "Có 1 hợp chất theo snapshot." },
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 8 },
    },
  });
};
const row = {
  id: "row-a",
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
  deltaPpm: 8,
  deltaRt: 0,
  candidateCount: 1,
  molecularFormula: "C6H12O6",
  fragments: "50;75",
  reportedMzErrorPpm: null,
  sourceMetadata: { SpectrumID: "LIB-A" },
  status: "matched",
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
beforeAll(async () => {
  sql = new PGlite();
  for (const name of [
    "0001_accounts_reports.sql",
    "0002_research_ai.sql",
    "0003_ai_model_pricing.sql",
    "0004_ai_citations.sql",
    "0005_ai_quota_truncation.sql",
    "0006_ai_token_estimate.sql",
    "0007_ai_report_drafts.sql",
    "0008_ai_request_queue.sql",
    "0009_ai_feedback_lookup_vision.sql",
    "0010_report_templates.sql",
  ])
    await sql.exec(
      await readFile(
        new URL(`../../migrations/${name}`, import.meta.url),
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
    end: async () => sql.close(),
  };
  app = createApp(
    config,
    db,
    {
      upload: async () => ({ assetId: "none", version: "1" }),
      download: async () => Buffer.alloc(0),
      destroy: async () => {},
    },
    transport,
    {
      lookup: async (url) => {
        lookups.push(url);
        return Response.json({});
      },
      spectrum: async (url) => {
        lookups.push(url);
        return new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
          headers: { "content-type": "image/png" },
        });
      },
    },
  );
  a = supertest.agent(app.app);
  b = supertest.agent(app.app);
  const ca = await a.get("/api/auth/csrf"),
    cb = await b.get("/api/auth/csrf");
  const ra = await a
      .post("/api/auth/register")
      .set("X-CSRF-Token", ca.body.csrf)
      .send({
        email: "ai-a@example.com",
        password: "valid-password-123",
        displayName: "Research A",
      }),
    rb = await b
      .post("/api/auth/register")
      .set("X-CSRF-Token", cb.body.csrf)
      .send({
        email: "ai-b@example.com",
        password: "valid-password-123",
        displayName: "Research B",
      });
  expect(ra.status).toBe(201);
  expect(rb.status).toBe(201);
  csrfA = ra.body.csrf;
  csrfB = rb.body.csrf;
  userA = ra.body.user.id;
}, 20000);
afterAll(async () => {
  if (db) await db.end();
  else if (sql) await sql.close();
});
const post = (path: string, body: object) =>
  a.post(path).set("X-CSRF-Token", csrfA).send(body);
async function send(extra: Record<string, unknown> = {}) {
  return post(`/api/ai/conversations/${conversationId}/messages`, {
    clientRequestId: randomUUID(),
    message: "Phân tích báo cáo",
    context: { reportIds: [reportId], scope: "report" },
    ...extra,
  });
}
async function finish(id: string, state = "completed") {
  await vi.waitFor(
    async () => {
      const r = await a.get(`/api/ai/requests/${id}`);
      expect(r.status).toBe(200);
      expect(r.body.state).toBe(state);
    },
    { timeout: 5000, interval: 20 },
  );
  return (await a.get(`/api/ai/requests/${id}`)).body;
}
describe("Research project, provider and persistent chat", () => {
  it("creates scoped projects/sessions and attaches only owned reports", async () => {
    const p = await post("/api/projects", {
      name: "Project A",
      researchGoal: "Compare GNPS reports",
    });
    expect(p.status).toBe(201);
    projectId = p.body.id;
    otherProject = (await post("/api/projects", { name: "Other project" })).body
      .id;
    const r = await app.reports!.create(
      userA,
      "Research report",
      result,
      randomUUID(),
    );
    reportId = r.reportId;
    const r2 = await app.reports!.create(
      userA,
      "Outside project",
      result,
      randomUUID(),
    );
    otherReport = r2.reportId;
    expect(
      (await post(`/api/projects/${projectId}/reports`, { reportId })).status,
    ).toBe(204);
    expect(
      (await post(`/api/projects/${otherProject}/reports`, { reportId }))
        .status,
    ).toBe(409);
    expect((await b.get(`/api/projects/${projectId}/reports`)).status).toBe(
      404,
    );
    expect(
      (
        await b
          .post(`/api/projects/${projectId}/research-sessions`)
          .set("X-CSRF-Token", csrfB)
          .send({ title: "Evil" })
      ).status,
    ).toBe(404);
    const s = await post(`/api/projects/${projectId}/research-sessions`, {
      title: "Session A",
    });
    expect(s.status).toBe(201);
    sessionId = s.body.id;
    expect(
      (
        await a
          .patch(`/api/research-sessions/${sessionId}`)
          .set("X-CSRF-Token", csrfA)
          .send({ activeReportId: otherReport })
      ).status,
    ).toBe(404);
    expect(
      (
        await a
          .patch(`/api/research-sessions/${sessionId}`)
          .set("X-CSRF-Token", csrfA)
          .send({ activeReportId: reportId })
      ).status,
    ).toBe(200);
    conversationId = (
      await post(`/api/research-sessions/${sessionId}/conversations`, {})
    ).body.id;
  });
  it("encrypts API key, discovers model and configures a default without leaking credentials", async () => {
    const p = await post("/api/ai/providers", {
      name: "Test Provider",
      baseUrl: "https://example.com/v1",
      apiKey: "test-secret-key",
    });
    expect(p.status).toBe(201);
    providerId = p.body.id;
    expect(
      JSON.stringify((await a.get("/api/ai/providers")).body),
    ).not.toContain("test-secret-key");
    expect(
      (
        await db.query("SELECT secret FROM ai_providers WHERE id=$1", [
          providerId,
        ])
      ).rows[0].secret.ciphertext,
    ).not.toBe("test-secret-key");
    expect(
      (await post(`/api/ai/providers/${providerId}/discover-models`, {}))
        .status,
    ).toBe(200);
    expect(
      (
        await post("/api/ai/settings", {
          scope: "account",
          providerId,
          modelId: "test-model",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await post(`/api/ai/providers/${providerId}/test`, {
          modelId: "test-model",
        })
      ).body.ok,
    ).toBe(true);
    expect(
      (
        await b
          .post(`/api/ai/providers/${providerId}/models`)
          .set("X-CSRF-Token", csrfB)
          .send({ modelId: "bad" })
      ).status,
    ).toBe(404);
  });
  it("saves several models in one request, all or nothing", async () => {
    const put = (body: object) =>
      a
        .put(`/api/ai/providers/${providerId}/models`)
        .set("X-CSRF-Token", csrfA)
        .send(body);
    const saved = await put({
      models: [
        { modelId: "bulk-a", displayName: "Bulk A", contextLimit: 32000 },
        { modelId: "bulk-b", supportsTools: true },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(2);
    const bad = await put({
      models: [
        { modelId: "bulk-a", displayName: "Changed" },
        { modelId: "bulk-c", contextLimit: 1 },
      ],
    });
    expect(bad.status).toBe(400);
    const rows = (
      await db.query(
        "SELECT model_id,display_name,context_limit,supports_tools FROM ai_provider_models WHERE provider_id=$1 AND model_id LIKE 'bulk-%' ORDER BY model_id",
        [providerId],
      )
    ).rows;
    expect(rows).toEqual([
      {
        model_id: "bulk-a",
        display_name: "Bulk A",
        context_limit: 32000,
        supports_tools: false,
      },
      {
        model_id: "bulk-b",
        display_name: "bulk-b",
        context_limit: 16000,
        supports_tools: true,
      },
    ]);
    expect((await put({ models: [] })).status).toBe(400);
  });
  it("starts a project from a report and a session from its first question", async () => {
    const source = (
      await app.reports!.create(userA, "Báo cáo nguồn", result, randomUUID())
    ).reportId;
    const p = await post("/api/projects", { fromReportId: source });
    expect(p.status).toBe(201);
    expect(p.body.name).toBe("Báo cáo nguồn");
    expect(
      (await a.get(`/api/projects/${p.body.id}/reports`)).body.map(
        (r: any) => r.id,
      ),
    ).toEqual([source]);
    // Already moved: a second project cannot take it.
    expect((await post("/api/projects", { fromReportId: source })).status).toBe(
      409,
    );
    expect((await post("/api/projects", {})).status).toBe(400);
    const question = "Hợp chất nào có MQScore thấp? Giải thích giúp tôi.";
    expect(
      (
        await post(`/api/projects/${p.body.id}/research-sessions`, {
          question,
          activeReportId: otherReport,
        })
      ).status,
    ).toBe(404);
    const s = await post(`/api/projects/${p.body.id}/research-sessions`, {
      question,
      activeReportId: source,
    });
    expect(s.status).toBe(201);
    expect(s.body.title).toBe("Hợp chất nào có MQScore thấp?");
    expect(s.body.active_report_id).toBe(source);
    const before = calls;
    const titled = await post(
      `/api/research-sessions/${s.body.id}/auto-title`,
      {
        question,
      },
    );
    expect(titled.status).toBe(200);
    expect(titled.body.title).toBe("Có 1 hợp chất theo snapshot");
    expect(calls).toBe(before + 1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM ai_provider_usage_events WHERE kind='title'",
        )
      ).rows[0].n,
    ).toBe(1);
    // No longer the draft title (summarised or renamed): nothing is called.
    const again = await post(`/api/research-sessions/${s.body.id}/auto-title`, {
      question,
    });
    expect(again.body.title).toBe("Có 1 hợp chất theo snapshot");
    expect(calls).toBe(before + 1);
  });
  it("rejects CSRF, unsafe endpoints and cross-project context", async () => {
    expect(
      (await a.post("/api/projects").send({ name: "Missing csrf" })).status,
    ).toBe(403);
    expect(
      (
        await post("/api/ai/providers", {
          name: "Internal",
          baseUrl: "https://127.0.0.1",
          apiKey: "secret",
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ context: { reportIds: [otherReport], scope: "report" } }))
        .status,
    ).toBe(404);
    expect(
      (
        await send({
          context: {
            reportIds: [reportId],
            expectedRevisions: { [reportId]: 99 },
          },
        })
      ).status,
    ).toBe(409);
  });
  it("persists full real report-row snapshot and idempotent request, protects all reads", async () => {
    const key = randomUUID(),
      r = await send({ clientRequestId: key });
    expect(r.status).toBe(202);
    const before = calls;
    const state = await finish(r.body.requestId);
    const repeat = await send({ clientRequestId: key });
    expect(repeat.body.requestId).toBe(r.body.requestId);
    expect(calls).toBe(before);
    expect(state.sources[0].reportId).toBe(reportId);
    expect(state.usage.input_tokens).toBe(12);
    const snapshot = (
      await db.query("SELECT payload FROM ai_context_snapshots WHERE id=$1", [
        state.snapshotId,
      ])
    ).rows[0].payload;
    expect(snapshot.reports[0].rows[0].compoundName).toBe("Compound A");
    expect(snapshot.reports[0].rows[0].deltaPpm).toBe(8);
    expect(
      captured
        .at(-1)
        .messages.some((m: any) => String(m.content).includes("Compound A")),
    ).toBe(true);
    expect(
      (await b.get(`/api/ai/conversations/${conversationId}/messages`)).status,
    ).toBe(404);
    expect((await b.get(`/api/ai/requests/${r.body.requestId}`)).status).toBe(
      404,
    );
    expect(
      (await b.get(`/api/ai/requests/${r.body.requestId}/events`)).status,
    ).toBe(404);
    expect(
      (
        await b
          .post(`/api/ai/requests/${r.body.requestId}/cancel`)
          .set("X-CSRF-Token", csrfB)
          .send({})
      ).status,
    ).toBe(404);
    const exported = await a.get(
      `/api/ai/conversations/${conversationId}/export`,
    );
    expect(exported.body.messages).toHaveLength(2);
    expect(JSON.stringify(exported.body)).not.toContain("test-secret-key");
  });
  it("retains user message on provider failure and retries without duplicating the user", async () => {
    mode = "failure";
    const r = await send();
    expect(r.status).toBe(202);
    const failed = await finish(r.body.requestId, "failed");
    expect(failed.error).toContain("429");
    const initial = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items;
    const users = initial.filter((m: any) => m.role === "user").length;
    mode = "success";
    const retry = await send({ retryOf: r.body.requestId });
    expect(retry.status).toBe(202);
    await finish(retry.body.requestId);
    const after = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items;
    expect(after.filter((m: any) => m.role === "user")).toHaveLength(users);
  });
  it("supports read-only tools against immutable rows and records execution/usage", async () => {
    expect(
      (
        await post(`/api/ai/providers/${providerId}/models`, {
          modelId: "test-model",
          supportsTools: true,
        })
      ).status,
    ).toBe(204);
    mode = "tool";
    const r = await send();
    const state = await finish(r.body.requestId);
    expect(state.toolRuns).toHaveLength(1);
    expect(state.toolRuns[0].result.rows[0].id).toBe("row-a");
    expect(state.toolRuns[0].result.examinedRows).toBe(1);
    expect(state.usage.input_tokens).toBe(22);
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("queues turns beyond AI_MAX_CONCURRENT and runs them when a slot frees", async () => {
    const conversations = [];
    for (let i = 0; i < 3; i++)
      conversations.push(
        (await post(`/api/research-sessions/${sessionId}/conversations`, {}))
          .body.id,
      );
    const sendTo = (id: string) =>
      post(`/api/ai/conversations/${id}/messages`, {
        clientRequestId: randomUUID(),
        message: "Phân tích báo cáo",
        context: { reportIds: [reportId], scope: "report" },
      });
    mode = "wait";
    const first = await sendTo(conversations[0]),
      second = await sendTo(conversations[1]);
    await finish(first.body.requestId, "running");
    await finish(second.body.requestId, "running");
    const third = await sendTo(conversations[2]);
    expect(third.status).toBe(202);
    const waiting = (await a.get(`/api/ai/requests/${third.body.requestId}`))
      .body;
    expect(waiting.state).toBe("queued");
    expect(waiting.queuePosition).toBe(1);
    mode = "success";
    await post(`/api/ai/requests/${first.body.requestId}/cancel`, {});
    const done = await finish(third.body.requestId);
    expect(done.content).toBe("Có 1 hợp chất theo snapshot.");
    // The stored prompt is only kept while a turn is queued or running.
    expect(
      (
        await db.query("SELECT prompt FROM ai_requests WHERE id=$1", [
          third.body.requestId,
        ])
      ).rows[0].prompt,
    ).toBeNull();
    await post(`/api/ai/requests/${second.body.requestId}/cancel`, {});
    await finish(second.body.requestId, "cancelled");
    for (const id of conversations)
      await a.delete(`/api/ai/conversations/${id}`).set("X-CSRF-Token", csrfA);
  });
  it("picks up a queued turn left in the database, as after a restart", async () => {
    const source = (
      await db.query(
        "SELECT * FROM ai_requests WHERE owner_id=$1 AND state='completed' ORDER BY started_at DESC LIMIT 1",
        [userA],
      )
    ).rows[0];
    const fresh = (
      await post(`/api/research-sessions/${sessionId}/conversations`, {})
    ).body.id;
    const id = randomUUID();
    await db.query(
      `INSERT INTO ai_requests(id,owner_id,conversation_id,client_request_id,state,provider_id,model_id,provider_name,context_snapshot_id,user_message,request_fingerprint,prompt) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,'',$10)`,
      [
        id,
        userA,
        fresh,
        randomUUID(),
        source.provider_id,
        source.model_id,
        source.provider_name,
        source.context_snapshot_id,
        source.user_message,
        JSON.stringify([
          { role: "system", content: "test" },
          { role: "user", content: source.user_message },
        ]),
      ],
    );
    await db.query(
      `INSERT INTO ai_messages(id,conversation_id,sequence,role,request_id,status) VALUES($1,$2,1,'assistant',$3,'queued')`,
      [randomUUID(), fresh, id],
    );
    await db.query(
      "INSERT INTO ai_usage(request_id,reserved_tokens) VALUES($1,1000)",
      [id],
    );
    // No send call: the periodic worker must find it.
    await vi.waitFor(
      async () =>
        expect((await a.get(`/api/ai/requests/${id}`)).body.state).toBe(
          "completed",
        ),
      { timeout: 6000, interval: 100 },
    );
    // The injected row borrows another conversation's snapshot; drop it first.
    await db.query("DELETE FROM ai_requests WHERE id=$1", [id]);
    await a.delete(`/api/ai/conversations/${fresh}`).set("X-CSRF-Token", csrfA);
  });
  it("locks a busy conversation and cancellation preserves status even after upstream abort", async () => {
    mode = "wait";
    const r = await send();
    expect(r.status).toBe(202);
    expect((await send()).status).toBe(409);
    expect(
      (await post(`/api/ai/requests/${r.body.requestId}/cancel`, {})).body
        .state,
    ).toBe("cancelled");
    await finish(r.body.requestId, "cancelled");
    const m = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find(
      (x: any) => x.request_id === r.body.requestId && x.role === "assistant",
    );
    expect(m.status).toBe("cancelled");
    mode = "success";
  });
  it("streams provider content, serves final SSE and marks missing usage unknown", async () => {
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsStream: true,
    });
    mode = "stream";
    const r = await send();
    const state = await finish(r.body.requestId);
    expect(state.content).toBe("Trả lời stream");
    expect(state.usage.output_tokens).toBe(4);
    const events = await a.get(`/api/ai/requests/${r.body.requestId}/events`);
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.text).toContain("event: state");
    expect(events.text).toContain("Trả lời stream");
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("streams tool rounds, sends refs instead of UUIDs and validates citations", async () => {
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsTools: true,
      supportsStream: true,
    });
    mode = "streamTool";
    captured = [];
    const r = await send();
    const state = await finish(r.body.requestId);
    expect(state.content).toBe("Dòng lệch ppm: [R1-1], sai [R1-9]");
    expect(state.toolRuns).toHaveLength(1);
    expect(state.toolRuns[0].result.rows[0].id).toBe("row-a");
    expect(state.usage.input_tokens).toBe(16);
    expect(state.citations).toEqual([
      { ref: "R1-1", reportId, rowId: "row-a", status: "ok" },
      { ref: "R1-9", reportId: null, rowId: null, status: "invalid" },
    ]);
    expect(captured[0].stream).toBe(true);
    expect(captured[0].stream_options).toEqual({ include_usage: true });
    expect(captured[0].tools.length).toBeGreaterThan(0);
    const toolMessage = captured[1].messages.find(
      (m: any) => m.role === "tool",
    );
    expect(toolMessage.content).toContain('"ref":"R1-1"');
    expect(toolMessage.content).not.toContain(reportId);
    expect(JSON.stringify(captured[0].messages)).not.toContain(reportId);
    const listed = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find(
      (m: any) => m.request_id === r.body.requestId && m.role === "assistant",
    );
    expect(listed.citations).toHaveLength(2);
    const rows = (await a.get(`/api/ai/requests/${r.body.requestId}/citations`))
      .body;
    expect(rows[0]).toMatchObject({
      ref: "R1-1",
      status: "ok",
      row: { compoundName: "Compound A", ppm: 8, sourceTsvRow: 1 },
    });
    expect(rows[1]).toMatchObject({
      ref: "R1-9",
      status: "invalid",
      row: null,
    });
    expect(
      (await b.get(`/api/ai/requests/${r.body.requestId}/citations`)).status,
    ).toBe(404);
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("recovers expired request leases as interrupted and keeps immutable snapshots after report edits", async () => {
    const id = randomUUID(),
      snapshot = (
        await db.query(
          "SELECT id FROM ai_context_snapshots WHERE owner_id=$1 LIMIT 1",
          [userA],
        )
      ).rows[0].id;
    await db.query(
      `INSERT INTO ai_requests(id,owner_id,conversation_id,client_request_id,state,provider_id,model_id,provider_name,context_snapshot_id,lease_until) VALUES($1,$2,$3,$4,'running',$5,'test-model','Test',$6,now()-interval '1 minute')`,
      [id, userA, conversationId, randomUUID(), providerId, snapshot],
    );
    const recovered = await a.get(`/api/ai/requests/${id}`);
    expect(recovered.body.state).toBe("interrupted");
    const updated = await app.reports!.update(
      userA,
      reportId,
      "Changed title",
      { ...result, rows: [{ ...row, compoundName: "Changed" }] },
      1,
    );
    expect(updated.revision).toBe(2);
    const old = (
      await db.query("SELECT payload FROM ai_context_snapshots WHERE id=$1", [
        snapshot,
      ])
    ).rows[0].payload;
    expect(old.reports[0].rows[0].compoundName).toBe("Compound A");
  });
  it("archives a project reversibly and blocks new context", async () => {
    expect(
      (
        await a
          .patch(`/api/projects/${projectId}`)
          .set("X-CSRF-Token", csrfA)
          .send({ archived: true })
      ).status,
    ).toBe(200);
    expect((await send()).status).toBe(404);
    expect(
      (
        await a
          .patch(`/api/projects/${projectId}`)
          .set("X-CSRF-Token", csrfA)
          .send({ archived: false })
      ).status,
    ).toBe(200);
    expect((await a.get(`/api/reports/${reportId}`)).status).toBe(200);
  });
  it("keeps truncated answers and marks them for continuation", async () => {
    mode = "truncated";
    let state = await finish((await send()).body.requestId);
    expect(state.content).toBe("Phần đầu");
    expect(state.finishReason).toBe("length");
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsStream: true,
    });
    mode = "streamTruncated";
    state = await finish((await send()).body.requestId);
    expect(state.content).toBe("Phần đầu");
    expect(state.finishReason).toBe("length");
    const listed = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find(
      (m: any) => m.request_id === state.requestId && m.role === "assistant",
    );
    expect(listed.finish_reason).toBe("length");
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("retries without stream_options once and remembers the model", async () => {
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsStream: true,
    });
    mode = "noStreamOptions";
    captured = [];
    let state = await finish((await send()).body.requestId);
    expect(state.content).toBe("OK");
    expect(captured.map((b) => Boolean(b.stream_options))).toEqual([
      true,
      false,
    ]);
    captured = [];
    state = await finish((await send()).body.requestId);
    expect(state.content).toBe("OK");
    expect(captured.map((b) => Boolean(b.stream_options))).toEqual([false]);
    expect(
      (
        await db.query(
          "SELECT stream_options_rejected FROM ai_provider_models WHERE provider_id=$1 AND model_id='test-model'",
          [providerId],
        )
      ).rows[0].stream_options_rejected,
    ).toBe(true);
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("previews the token estimate and reserves each tool round separately", async () => {
    expect(
      (
        await db.query(
          "SELECT token_calibration FROM ai_provider_models WHERE provider_id=$1 AND model_id='test-model'",
          [providerId],
        )
      ).rows[0].token_calibration,
    ).not.toBeNull();
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsTools: true,
    });
    const body = {
      message: "Phân tích báo cáo",
      context: { reportIds: [reportId], scope: "report" },
    };
    const preview = await post(
      `/api/ai/conversations/${conversationId}/preview`,
      body,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      outputMax: 2000,
      fits: true,
      reason: null,
      toolRounds: true,
      rows: { sent: 1, truncated: false },
    });
    expect(preview.body.reserve).toBe(preview.body.input + 2000);
    expect(preview.body.breakdown.data).toBeGreaterThan(0);
    expect(preview.body.breakdown.tools).toBeGreaterThan(0);
    // Room for the first call only: the tool round must stop at its own reservation.
    const used = preview.body.quota.monthUsed;
    await a
      .patch(`/api/ai/providers/${providerId}`)
      .set("X-CSRF-Token", csrfA)
      .send({
        monthlyTokenLimit: used + preview.body.reserve + 10,
        quotaReservePercent: 0,
      });
    mode = "tool";
    const r = await post(`/api/ai/conversations/${conversationId}/messages`, {
      ...body,
      clientRequestId: randomUUID(),
    });
    expect(r.status).toBe(202);
    const state = await finish(r.body.requestId, "failed");
    expect(state.error).toContain("Hạn mức token");
    expect(state.toolRuns).toHaveLength(1);
    await a
      .patch(`/api/ai/providers/${providerId}`)
      .set("X-CSRF-Token", csrfA)
      .send({ monthlyTokenLimit: 2000000, quotaReservePercent: 10 });
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("chat test probes plain, stream and tool support", async () => {
    const r = await post(`/api/ai/providers/${providerId}/test`, {
      modelId: "test-model",
    });
    expect(r.status).toBe(200);
    expect(r.body.checks).toMatchObject({
      stream: "ok",
      streamOptions: "accepted",
      streamUsage: true,
      tools: "ok",
      usage: true,
    });
  });
  it("pools quota for providers sharing a key and counts chat tests", async () => {
    const before = (await a.get("/api/ai/providers")).body.find(
      (x: any) => x.id === providerId,
    ).quota.monthUsed;
    expect(
      (
        await post(`/api/ai/providers/${providerId}/test`, {
          modelId: "test-model",
        })
      ).status,
    ).toBe(200);
    const twin = await post("/api/ai/providers", {
      name: "Same account",
      baseUrl: "https://example.com/v1",
      apiKey: "test-secret-key",
    });
    const other = await post("/api/ai/providers", {
      name: "Other account",
      baseUrl: "https://example.com/v1",
      apiKey: "another-key",
    });
    const list = (await a.get("/api/ai/providers")).body,
      main = list.find((x: any) => x.id === providerId),
      same = list.find((x: any) => x.id === twin.body.id),
      diff = list.find((x: any) => x.id === other.body.id);
    expect(main.quota.monthUsed).toBeGreaterThan(before);
    expect(same.quota.monthUsed).toBe(main.quota.monthUsed);
    expect(same.quota.sharedWith).toBe(1);
    expect(diff.quota.monthUsed).toBe(0);
    expect(JSON.stringify(list)).not.toContain("key_fingerprint");
    expect(JSON.stringify(list)).not.toContain("ciphertext");
    for (const id of [twin.body.id, other.body.id])
      await a
        .patch(`/api/ai/providers/${id}`)
        .set("X-CSRF-Token", csrfA)
        .send({ enabled: false });
  });
  it("enforces the provider token quota and settles failed calls", async () => {
    const providers = (await a.get("/api/ai/providers")).body,
      p = providers.find((x: any) => x.id === providerId);
    expect(Number(p.monthly_token_limit)).toBe(2000000);
    expect(p.quota).toMatchObject({
      monthLimit: 2000000,
      monthUsable: 1800000,
      reservePercent: 10,
    });
    expect(p.quota.monthUsed).toBeGreaterThan(0);
    mode = "failure";
    const failed = await finish((await send()).body.requestId, "failed");
    expect(failed.usage.usage_source).toBe("estimated");
    expect(failed.usage.input_tokens).toBeGreaterThan(0);
    mode = "success";
    const patch = await a
      .patch(`/api/ai/providers/${providerId}`)
      .set("X-CSRF-Token", csrfA)
      .send({ monthlyTokenLimit: p.quota.monthUsed + 1000 });
    expect(patch.status).toBe(204);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code ?? blocked.body.error?.code ?? "").toContain(
      "AI_PROVIDER_QUOTA",
    );
    await a
      .patch(`/api/ai/providers/${providerId}`)
      .set("X-CSRF-Token", csrfA)
      .send({ monthlyTokenLimit: null, dailyTokenLimit: null });
    expect((await send()).status).toBe(202);
  });
  it("keeps a reviewed discussion draft and appends it to the Word export", async () => {
    const answer = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find(
      (m: any) => m.role === "assistant" && m.citations?.length,
    );
    const fromChat = await a
      .put(`/api/ai/reports/${reportId}/discussion`)
      .set("X-CSRF-Token", csrfA)
      .send({ requestId: answer.request_id });
    expect(fromChat.status).toBe(200);
    expect(fromChat.body.content).not.toContain("[R1-1]");
    expect(fromChat.body.content).toContain("R1-9 (không tồn tại)");
    expect(fromChat.body.content).toContain("dòng TSV 1");
    const edited = await a
      .put(`/api/ai/reports/${reportId}/discussion`)
      .set("X-CSRF-Token", csrfA)
      .send({ content: "## Nhận xét\n- **Compound A** khớp tốt <b>x</b>" });
    expect(edited.status).toBe(200);
    expect((await b.get(`/api/ai/reports/${reportId}/discussion`)).status).toBe(
      404,
    );
    const revision = (await a.get(`/api/reports/${reportId}`)).body.revision;
    const docx = await a
      .post(`/api/reports/${reportId}/export/docx`)
      .set("X-CSRF-Token", csrfA)
      .send({ revision })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(docx.status).toBe(200);
    const xml = await (
      await JSZip.loadAsync(docx.body)
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain("KẾT QUẢ VÀ THẢO LUẬN");
    expect(xml).toContain("Compound A");
    expect(xml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(
      (
        await a
          .delete(`/api/ai/reports/${reportId}/discussion`)
          .set("X-CSRF-Token", csrfA)
      ).status,
    ).toBe(204);
    expect(
      (await a.get(`/api/ai/reports/${reportId}/discussion`)).body,
    ).toBeNull();
  });
  it("offers external lookup only when the project opts in", async () => {
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsTools: true,
    });
    const names = () =>
      captured[0].tools.map((t: any) => t.function.name) as string[];
    mode = "success";
    captured = [];
    await finish((await send()).body.requestId);
    expect(names()).not.toContain("lookup_compound");
    const patched = await a
      .patch(`/api/projects/${projectId}`)
      .set("X-CSRF-Token", csrfA)
      .send({ allowExternalLookup: true });
    expect(patched.body.allow_external_lookup).toBe(true);
    mode = "lookup";
    captured = [];
    const state = await finish((await send()).body.requestId);
    expect(names()).toContain("lookup_compound");
    expect(state.toolRuns[0]).toMatchObject({
      tool_name: "lookup_compound",
      result: {
        row: { ref: "R1-1" },
        pubchem: { status: "skipped" },
        npclassifier: { status: "skipped" },
      },
    });
    // The fixture row has no InChIKey/SMILES, so nothing left the server.
    expect(lookups).toEqual([]);
    await a
      .patch(`/api/projects/${projectId}`)
      .set("X-CSRF-Token", csrfA)
      .send({ allowExternalLookup: false });
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
    mode = "success";
  });
  it("attaches the GNPS2 mirror plot for one selected row on vision models", async () => {
    const task = "2515573ac8c24ec8b85f553aad9b440e";
    const gnps = await app.reports!.create(
      userA,
      "GNPS task report",
      {
        ...result,
        task,
        rows: [
          {
            ...row,
            id: "row-g",
            sourceMetadata: {
              "#Scan#": "33",
              SpectrumID: "CCMSLIB00005720803",
            },
          },
        ],
      } as any,
      randomUUID(),
    );
    await post(`/api/projects/${projectId}/reports`, {
      reportId: gnps.reportId,
    });
    const body = () => ({
      clientRequestId: randomUUID(),
      message: "Nhận xét mirror plot",
      attachSpectrum: true,
      context: {
        reportIds: [gnps.reportId],
        scope: "selection",
        selectedRowIds: ["row-g"],
      },
    });
    const refused = await post(
      `/api/ai/conversations/${conversationId}/messages`,
      body(),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("AI_NO_VISION");
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
      supportsVision: true,
    });
    const preview = await post(
      `/api/ai/conversations/${conversationId}/preview`,
      body(),
    );
    expect(preview.body).toMatchObject({
      image: 1100,
      supportsVision: true,
      fits: true,
    });
    mode = "success";
    captured = [];
    lookups.length = 0;
    const sent = await post(
      `/api/ai/conversations/${conversationId}/messages`,
      body(),
    );
    expect(sent.status).toBe(202);
    await finish(sent.body.requestId);
    expect(lookups[0]).toContain("/png/mirror/?usi1=");
    expect(decodeURIComponent(lookups[0])).toContain(`TASK-${task}`);
    const question = captured[0].messages.at(-1);
    expect(question.content[1].image_url.url).toMatch(
      /^data:image\/png;base64,/,
    );
    const listed = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find(
      (m: any) => m.request_id === sent.body.requestId && m.role === "user",
    );
    expect(listed.attachments[0]).toMatchObject({
      type: "mirror_plot",
      scan: "33",
      spectrumId: "CCMSLIB00005720803",
    });
    // A report row without scan/SpectrumID cannot have a mirror plot.
    const plain = await post(
      `/api/ai/conversations/${conversationId}/messages`,
      {
        ...body(),
        context: {
          reportIds: [reportId],
          scope: "selection",
          selectedRowIds: ["row-a"],
        },
      },
    );
    expect(plain.status).toBe(400);
    expect(plain.body.code).toBe("AI_NO_SPECTRUM");
    await post(`/api/ai/providers/${providerId}/models`, {
      modelId: "test-model",
    });
  });
  it("stores owner feedback on finished answers and exports it", async () => {
    const answers = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.filter((m: any) => m.role === "assistant");
    const done = answers.find((m: any) => m.status === "completed"),
      failed = answers.find((m: any) => m.status === "failed");
    const put = (id: string, body: object, agent = a, csrf = csrfA) =>
      agent
        .put(`/api/ai/requests/${id}/feedback`)
        .set("X-CSRF-Token", csrf)
        .send(body);
    expect(
      (await put(done.request_id, { rating: -1, comment: "Sai số ppm" }))
        .status,
    ).toBe(200);
    expect((await put(done.request_id, { rating: 2 })).status).toBe(400);
    expect((await put(failed.request_id, { rating: 1 })).status).toBe(400);
    expect((await put(done.request_id, { rating: 1 }, b, csrfB)).status).toBe(
      404,
    );
    const listed = (
      await a.get(`/api/ai/conversations/${conversationId}/messages`)
    ).body.items.find((m: any) => m.id === done.id);
    expect(listed).toMatchObject({
      feedback_rating: -1,
      feedback_comment: "Sai số ppm",
    });
    const exported = (await a.get("/api/ai/feedback/export")).body;
    expect(exported[0]).toMatchObject({ rating: -1, comment: "Sai số ppm" });
    expect(exported[0].question.length).toBeGreaterThan(0);
    expect((await b.get("/api/ai/feedback/export")).body).toEqual([]);
  });
  it("shows system-wide aggregates only to a verified admin", async () => {
    // Listed email but registered with a password: not verified, not admin.
    expect((await a.get("/api/ai/admin/usage")).status).toBe(403);
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      userA,
    ]);
    const r = await a.get("/api/ai/admin/usage?days=7");
    expect(r.status).toBe(200);
    expect(r.body.accounts[0]).toMatchObject({ email: "ai-a@example.com" });
    expect(r.body.accounts[0].requests).toBeGreaterThan(0);
    expect(r.body.models.length).toBeGreaterThan(0);
    expect(r.body.queue).toMatchObject({ queued: 0, maxConcurrent: 2 });
    expect(
      r.body.models.reduce((n: number, m: any) => n + m.thumbs_down, 0),
    ).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain("Sai số ppm");
    expect(JSON.stringify(r.body)).not.toContain("Có 1 hợp chất");
    expect((await b.get("/api/ai/admin/usage")).status).toBe(403);
  });
  it("summarizes own usage by day and model", async () => {
    const mine = (await a.get("/api/ai/usage/summary?days=7")).body;
    expect(mine.days).toBe(7);
    expect(mine.byDay[0].requests).toBeGreaterThan(0);
    const model = mine.byModel.find((m: any) => m.model_id === "test-model");
    expect(model.requests).toBeGreaterThan(model.failed);
    expect(model.input_tokens).toBeGreaterThan(0);
    expect(model.actual_to_estimate).toBeGreaterThan(0);
    expect(model.cached_input_tokens).toBeGreaterThan(0);
    expect((await b.get("/api/ai/usage/summary")).body.byModel).toEqual([]);
  });
  it("manages Word templates and exports a report through one", async () => {
    const created = await post("/api/report-templates", {
      name: "Mẫu luận văn",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.content.content[0].type).toBe("heading");
    expect((await b.get(`/api/report-templates/${id}`)).status).toBe(404);
    const patched = await a
      .patch(`/api/report-templates/${id}`)
      .set("X-CSRF-Token", csrfA)
      .send({
        page: { orientation: "portrait" },
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Báo cáo: " },
                { type: "field", attrs: { key: "report.title" } },
                { type: "field", attrs: { key: "constructor" } },
              ],
            },
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  attrs: { repeat: { filter: "all", sort: "report" } },
                  content: [
                    {
                      type: "tableCell",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "field",
                              attrs: { key: "row.compoundName" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    expect(patched.status).toBe(200);
    expect(JSON.stringify(patched.body.content)).not.toContain("constructor");
    expect(patched.body.page.orientation).toBe("portrait");
    const copy = await post(`/api/report-templates/${id}/duplicate`, {});
    expect(copy.body.name).toBe("Mẫu luận văn (bản sao)");
    expect((await a.get("/api/report-templates")).body.length).toBe(2);
    const saved = (await a.get(`/api/reports/${reportId}`)).body,
      revision = saved.revision;
    const docx = await a
      .post(`/api/reports/${reportId}/export/template/${id}`)
      .set("X-CSRF-Token", csrfA)
      .send({ revision })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(docx.status).toBe(200);
    const xml = await (
      await JSZip.loadAsync(docx.body)
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain("Báo cáo: ");
    expect(xml).toContain(saved.title);
    expect(xml).toContain(saved.rows[0].compoundName);
    expect(
      (
        await a
          .post(`/api/reports/${reportId}/export/template/${id}`)
          .set("X-CSRF-Token", csrfB)
          .send({ revision })
      ).status,
    ).toBe(403);
    expect(
      (
        await b
          .post(`/api/reports/${reportId}/export/template/${id}`)
          .set("X-CSRF-Token", csrfB)
          .send({ revision })
      ).status,
    ).toBe(404);
    for (const t of [id, copy.body.id])
      expect(
        (
          await a
            .delete(`/api/report-templates/${t}`)
            .set("X-CSRF-Token", csrfA)
        ).status,
      ).toBe(204);
  });
  it("serves the server-side review queue only to the report owner", async () => {
    const q = await a.get(`/api/ai/reports/${reportId}/review-queue?limit=5`);
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({
      examinedRows: 1,
      flaggedRows: 0,
      items: [],
    });
    expect(
      (await b.get(`/api/ai/reports/${reportId}/review-queue`)).status,
    ).toBe(404);
  });
  it("does not silently substitute zero for unknown provider usage", async () => {
    mode = "unknown";
    const r = await send();
    expect(r.status).toBe(202);
    const state = await finish(r.body.requestId);
    expect(state.usage.input_tokens).toBeNull();
    expect(state.usage.usage_source).toBe("unknown");
    mode = "success";
  });
  it("rejects replaying an idempotency key with different content and enforces daily quota", async () => {
    const key = randomUUID(),
      r = await send({ clientRequestId: key });
    expect(r.status).toBe(202);
    await finish(r.body.requestId);
    expect(
      (await send({ clientRequestId: key, message: "Different question" }))
        .status,
    ).toBe(409);
    const budget = (
      await db.query("SELECT * FROM ai_daily_budgets WHERE owner_id=$1", [
        userA,
      ])
    ).rows[0];
    await db.query(
      "UPDATE ai_daily_budgets SET requests=$2 WHERE owner_id=$1",
      [userA, config.aiDailyRequests],
    );
    const previousCalls = calls;
    expect((await send()).status).toBe(429);
    expect(calls).toBe(previousCalls);
    await db.query(
      "UPDATE ai_daily_budgets SET requests=$2 WHERE owner_id=$1",
      [userA, budget.requests],
    );
  });
  it("stores versioned history excerpts without losing original messages", async () => {
    const base = Number(
        (
          await db.query(
            "SELECT max(sequence) AS n FROM ai_messages WHERE conversation_id=$1",
            [conversationId],
          )
        ).rows[0].n,
      ),
      snapshot = (
        await db.query(
          "SELECT id FROM ai_context_snapshots WHERE owner_id=$1 LIMIT 1",
          [userA],
        )
      ).rows[0].id;
    for (let i = 0; i < 17; i++) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO ai_requests(id,owner_id,conversation_id,client_request_id,state,provider_id,model_id,provider_name,context_snapshot_id,user_message) VALUES($1,$2,$3,$4,'completed',$5,'test-model','Test',$6,$7)`,
        [
          id,
          userA,
          conversationId,
          randomUUID(),
          providerId,
          snapshot,
          `History question ${i}`,
        ],
      );
      await db.query(
        `INSERT INTO ai_messages(id,conversation_id,sequence,role,content,request_id,status) VALUES($1,$2,$3,'assistant',$4,$5,'completed')`,
        [randomUUID(), conversationId, base + i + 1, `History answer ${i}`, id],
      );
    }
    const r = await send();
    expect(r.status).toBe(202);
    const state = await finish(r.body.requestId);
    expect(state.contextInfo.historyOmitted).toBeGreaterThan(0);
    expect(state.contextInfo.summaryVersion).toBeGreaterThan(0);
    expect(
      (await a.get(`/api/ai/conversations/${conversationId}/messages`)).body
        .items.length,
    ).toBeGreaterThan(17);
  });
  it("snapshots model prices and preserves prior cost when prices change", async () => {
    expect(
      (
        await post("/api/ai/providers/" + providerId + "/models", {
          modelId: "test-model",
          inputPricePerMillion: 2,
          outputPricePerMillion: 5,
        })
      ).status,
    ).toBe(204);
    const r = await send();
    expect(r.status).toBe(202);
    const state = await finish(r.body.requestId);
    expect(Number(state.usage.estimated_cost)).toBeCloseTo(0.000049, 8);
    const version = state.usage.pricing_version;
    await post("/api/ai/providers/" + providerId + "/models", {
      modelId: "test-model",
      inputPricePerMillion: 200,
      outputPricePerMillion: 500,
    });
    const old = (await a.get("/api/ai/requests/" + r.body.requestId)).body;
    expect(old.usage.estimated_cost).toBe(state.usage.estimated_cost);
    expect(old.usage.pricing_version).toBe(version);
  });
  it("deletes only chat/snapshots and retains reports and daily budget audit", async () => {
    const before = (
      await db.query(
        "SELECT requests,reserved_tokens FROM ai_daily_budgets WHERE owner_id=$1",
        [userA],
      )
    ).rows[0];
    expect(
      (
        await b
          .delete(`/api/ai/conversations/${conversationId}`)
          .set("X-CSRF-Token", csrfB)
      ).status,
    ).toBe(404);
    expect(
      (
        await a
          .delete(`/api/ai/conversations/${conversationId}`)
          .set("X-CSRF-Token", csrfA)
      ).status,
    ).toBe(204);
    expect((await a.get(`/api/reports/${reportId}`)).status).toBe(200);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM ai_context_snapshots WHERE owner_id=$1",
          [userA],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT requests,reserved_tokens FROM ai_daily_budgets WHERE owner_id=$1",
          [userA],
        )
      ).rows[0],
    ).toEqual(before);
  });
});
