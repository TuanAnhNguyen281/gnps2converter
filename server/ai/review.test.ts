import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { reviewRow } from "./review.js";
import { runTool, type ResearchContext } from "./context.js";

const clean = {
  status: "matched",
  deltaPpm: 2,
  candidateCount: 1,
  deltaRt: 0.05,
  sourceMetadata: { MQScore: 0.92, SharedPeaks: 14, Smiles: "CCO" },
};
describe("review score", () => {
  it("leaves a clean match unflagged", () => {
    expect(
      reviewRow(clean, { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.3 }),
    ).toEqual({ score: 0, reasons: [] });
  });
  it("adds explained points and caps at 100", () => {
    const r = reviewRow(
      {
        status: "ambiguous",
        deltaPpm: 25,
        candidateCount: 3,
        deltaRt: 0.6,
        sourceMetadata: { mqscore: "0.55", shared_peaks: 4 },
      },
      { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.3 },
    );
    expect(r.score).toBe(100);
    expect(r.reasons).toEqual([
      "Khớp chưa chắc chắn (RT lấy từ RT_Query hoặc nhiều ứng viên)",
      "Sai số 25.0 ppm vượt ngưỡng 10 ppm",
      "3 ứng viên cùng m/z",
      "MQScore thấp (0.55)",
      "Chỉ 4 peak trùng với phổ thư viện",
      "Lệch RT 0.60 vượt ngưỡng 0.3",
      "Không có SMILES/InChIKey để kiểm tra cấu trúc",
    ]);
  });
  it("prefers reported MZErrorPPM and the report's own ppm tolerance", () => {
    expect(
      reviewRow(
        { ...clean, deltaPpm: 1, reportedMzErrorPpm: 6 },
        {
          mzMode: "ppm",
          mzTolerance: 5,
        },
      ).reasons,
    ).toEqual(["Sai số 6.0 ppm vượt ngưỡng 5 ppm"]);
  });
});

const id = randomUUID();
const ctx: ResearchContext = {
  project: { id: randomUUID(), name: "P", research_goal: "" },
  session: { id: randomUUID(), title: "S" },
  selection: {
    reportIds: [id],
    selectedRowIds: [],
    scope: "report",
    expectedRevisions: {},
  },
  reports: [
    {
      id,
      title: "R",
      revision: 2,
      sourceUrl: null,
      parameters: { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.3 },
      rows: [
        {
          id: "a",
          compoundName: "X",
          adduct: "[M+H]+",
          status: "matched",
          deltaPpm: 1,
          rtData: 1,
          sourceMetadata: { Smiles: "C" },
        },
        {
          id: "b",
          compoundName: "x",
          adduct: "[M+H]+",
          status: "unmatched",
          deltaPpm: 30,
          rtData: 3,
          sourceMetadata: {},
        },
        {
          id: "c",
          compoundName: "Y",
          adduct: "[M+Na]+",
          status: "ambiguous",
          deltaPpm: -12,
          rtData: null,
          sourceMetadata: { Smiles: "N" },
        },
      ],
    },
  ],
};
describe("analysis tools", () => {
  it("ranks the review queue over all rows", () => {
    const q = runTool(ctx, "get_review_queue", { reportId: "R1" }) as any;
    expect(q.flaggedRows).toBe(2);
    expect(q.rows.map((r: any) => [r.ref, r.review.score])).toEqual([
      ["R1-2", 70],
      ["R1-3", 45],
    ]);
    expect(q.rule).toContain("không phải kết luận định danh");
  });
  it("groups, describes distributions and finds duplicates", () => {
    const g = runTool(ctx, "aggregate_report", {
      reportId: "R1",
      groupBy: "adduct",
    }) as any;
    expect(g.groups.map((x: any) => [x.key, x.count, x.ppmMaxAbs])).toEqual([
      ["[M+H]+", 2, 30],
      ["[M+Na]+", 1, 12],
    ]);
    const d = runTool(ctx, "distribution", {
      reportId: "R1",
      field: "rt",
      bins: 3,
    }) as any;
    expect([d.count, d.missing, d.min, d.max]).toEqual([2, 1, 1, 3]);
    expect(d.bins.reduce((n: number, b: any) => n + b.count, 0)).toBe(2);
    const dup = runTool(ctx, "find_duplicates", {
      reportId: "R1",
      by: "name",
    }) as any;
    expect(dup.groups).toEqual([
      {
        key: "x",
        count: 2,
        rows: [
          { reportId: id, id: "a", ref: "R1-1" },
          { reportId: id, id: "b", ref: "R1-2" },
        ],
      },
    ]);
    expect(() =>
      runTool(ctx, "aggregate_report", { reportId: "R1", groupBy: "sql" }),
    ).toThrow();
  });
});
