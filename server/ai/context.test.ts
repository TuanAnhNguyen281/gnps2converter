import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  initialContext,
  runTool,
  summarize,
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
    const initial = initialContext(ctx, 4000);
    expect(initial.truncated).toBe(true);
    expect(initial.examinedRows).toBe(1001);
    expect(initial.returnedRows).toBeLessThan(30);
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
  it("rejects prematurely terminated provider streams", async () => {
    await expect(
      streamCompletion(
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        async () => {},
      ),
    ).rejects.toThrow("kết thúc");
  });
});
