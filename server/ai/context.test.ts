import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  initialContext,
  remapCitations,
  runTool,
  summarize,
  toPrompt,
  tools,
  validateCitations,
  type ResearchContext,
} from "./context.js";
import {
  encryptKey,
  decryptKey,
  publicAddress,
  providerUrl,
  streamCompletion,
} from "./provider.js";
import { readConfig } from "../config.js";
const id = randomUUID(),
  other = randomUUID(),
  ctx: ResearchContext = {
    project: { id: randomUUID(), name: "Project", research_goal: "Analyze" },
    session: { id: randomUUID(), title: "Session" },
    selection: {
      reportIds: [id],
      selectedRowIds: [],
      scope: "report",
      expectedRevisions: {},
    },
    reports: [
      {
        id,
        title: "Full report",
        revision: 1,
        sourceUrl: null,
        parameters: {},
        rows: Array.from({ length: 1000 }, (_, i) => ({
          id: `row-${i}`,
          compoundName: `Compound ${i}`,
          deltaPpm: i,
          status: i % 2 ? "matched" : "unmatched",
          sourceMetadata: {},
        })),
      },
      {
        id: other,
        title: "Compare",
        revision: 1,
        sourceUrl: null,
        parameters: {},
        rows: [
          { id: "other-999", compoundName: "Compound 999", sourceMetadata: {} },
        ],
      },
    ],
  };
describe("Research context and provider safeguards", () => {
  it("aggregates full rows while disclosing prompt truncation", () => {
    expect(summarize(ctx.reports[0]).examinedRows).toBe(1000);
    expect(summarize(ctx.reports[0]).ppm.maxAbsolute).toBe(999);
    const initial = initialContext(ctx, 2000);
    expect(initial.truncated).toBe(true);
    expect(initial.examinedRows).toBe(1001);
    expect(initial.returnedRows).toBeLessThan(30);
  });
  it("sends compact rows with refs instead of UUIDs and whitelisted metadata", () => {
    const local: ResearchContext = {
      ...ctx,
      reports: [
        {
          ...ctx.reports[0],
          rows: [
            {
              id: "row-x",
              compoundName: "X",
              status: "matched",
              molecularFormula: null,
              fragments: "1".repeat(1000),
              sourceMetadata: {
                SpectrumID: "CCMSLIB1",
                MQScore: 0.91,
                INCHI_AUX: "noise",
                Data_Collector: "someone",
                Smiles: "",
              },
            },
          ],
        },
      ],
    };
    const initial = initialContext(local, 20000),
      prompt = toPrompt(local, initial);
    expect(initial.rows[0].id).toBe("row-x");
    expect(prompt).not.toContain(id);
    expect(prompt).not.toContain("row-x");
    expect(prompt).toContain('"ref":"R1-1"');
    expect(prompt).toContain('"reportId":"R1"');
    expect(prompt).toContain("CCMSLIB1");
    expect(prompt).not.toContain("INCHI_AUX");
    expect(prompt).not.toContain("Data_Collector");
    expect(prompt).not.toContain("molecularFormula");
    expect(prompt).toContain("fragmentsTruncated");
    const details = runTool(local, "get_compound_details", {
      rowId: "R1-1",
    }) as any;
    expect(details.row.fragments).toHaveLength(1000);
  });
  it("declares a dedicated schema per tool", () => {
    const byName = Object.fromEntries(
      tools.map((t) => [t.function.name, t.function]),
    );
    expect(byName.get_project_overview.parameters.properties).toEqual({});
    expect(byName.compare_reports.parameters.required).toEqual([
      "reportId",
      "otherReportId",
    ]);
    expect(byName.get_compound_details.parameters.required).toEqual(["rowId"]);
    expect(new Set(tools.map((t) => t.function.description)).size).toBe(
      tools.length,
    );
    expect(() =>
      runTool(ctx, "get_report_summary", { reportId: id, status: "matched" }),
    ).toThrow();
    expect(() => runTool(ctx, "get_report_summary", {})).toThrow();
    expect(
      (runTool(ctx, "get_report_summary", { reportId: "R1" }) as any).reportId,
    ).toBe(id);
    expect(
      (
        runTool(ctx, "query_report_rows", {
          reportId: "R1",
          status: null,
          sort: "abs_ppm_desc",
          limit: 1,
        }) as any
      ).rows[0].id,
    ).toBe("row-999");
  });
  it("validates citations against snapshot rows actually shown to the model", () => {
    const local = {
      ...ctx,
      promptContext: {
        initial: initialContext(ctx, 2000),
        historyIncluded: 0,
        historyOmitted: 0,
        summaryVersion: 0,
      },
    };
    const tool = runTool(local, "query_report_rows", {
      reportId: "R1",
      minAbsolutePpm: 995,
    });
    const citations = validateCitations(
      local,
      "Xem [R1], [R1-1, R1-996]; dòng [R1-500] và [R9-1], [R2-5]. [R1-1]",
      [tool],
    );
    expect(citations).toEqual([
      { ref: "R1", reportId: id, rowId: null, status: "ok" },
      { ref: "R1-1", reportId: id, rowId: "row-0", status: "ok" },
      { ref: "R1-996", reportId: id, rowId: "row-995", status: "ok" },
      { ref: "R1-500", reportId: id, rowId: "row-499", status: "unseen" },
      { ref: "R9-1", reportId: null, rowId: null, status: "invalid" },
      { ref: "R2-5", reportId: null, rowId: null, status: "invalid" },
    ]);
    const swapped = { ...ctx, reports: [ctx.reports[1], ctx.reports[0]] };
    expect(
      remapCitations("A [R1-996, R2-1] B [R2-1]", citations, swapped),
    ).toBe("A [R2-996] B [nguồn ngoài phạm vi hiện tại]");
  });
  it("filters full snapshot rather than prompt sample and paginates matches", () => {
    const result = runTool(ctx, "query_report_rows", {
      reportId: id,
      minAbsolutePpm: 990,
      limit: 2,
    }) as any;
    expect(result.matchingRows).toBe(10);
    expect(result.examinedRows).toBe(1000);
    expect(result.rows[0].id).toBe("row-990");
    expect(result.truncated).toBe(true);
  });
  it("compares with explicit identity rule and rejects out-of-scope tools/arguments", () => {
    const result = runTool(ctx, "compare_reports", {
      reportId: id,
      otherReportId: other,
    }) as any;
    expect(result.matchedLeftRows).toBe(1);
    expect(result.matchingRule).toContain(
      "does not establish chemical identity",
    );
    expect(() => runTool(ctx, "run_sql", {})).toThrow();
    expect(() =>
      runTool(ctx, "query_report_rows", { reportId: randomUUID() }),
    ).toThrow();
    expect(() =>
      runTool(ctx, "query_report_rows", { reportId: id, sql: "DELETE" }),
    ).toThrow();
  });
  it("encrypts secrets with random IV and supports versioned decryption", () => {
    const config = readConfig({ AI_ENCRYPTION_KEY: "ab".repeat(32) }),
      a = encryptKey("secret", config),
      b = encryptKey("secret", config);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptKey(a, "v1", config)).toBe("secret");
    expect(() => decryptKey({ ...a, tag: b.tag }, "v1", config)).toThrow();
  });
  it("rejects private, mapped IPv6, credentials and non-HTTPS provider URLs", () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "100.64.0.1",
      "2001:db8::1",
    ])
      expect(publicAddress(host)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
    const config = readConfig({});
    expect(() => providerUrl("http://example.com", "models", config)).toThrow();
    expect(() =>
      providerUrl("https://user:pass@example.com", "models", config),
    ).toThrow();
    expect(
      providerUrl("https://example.com/v1/", "models", config).pathname,
    ).toBe("/v1/models");
  });
  it("assembles streamed tool-call fragments", async () => {
    const texts: string[] = [];
    const r = await streamCompletion(
      new Response(
        [
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"query_report_rows","arguments":"{\\"reportId\\":"}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"R1\\"}"}}]},"finish_reason":"tool_calls"}]}',
          "[DONE]",
        ]
          .map((d) => `data: ${d}\n\n`)
          .join(""),
      ),
      async (t) => {
        texts.push(t);
      },
      true,
    );
    expect(r.toolCalls).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "query_report_rows", arguments: '{"reportId":"R1"}' },
      },
    ]);
    expect(texts).toEqual([]);
    await expect(
      streamCompletion(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"x"}}]}}]}\n\ndata: [DONE]\n\n',
        ),
        async () => {},
      ),
    ).rejects.toThrow("ngoài vòng");
  });
  it("rejects prematurely terminated provider streams", async () => {
    await expect(
      streamCompletion(
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        async () => {},
      ),
    ).rejects.toThrow("kết thúc");
  });
});
