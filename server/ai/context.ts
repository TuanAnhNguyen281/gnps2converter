import { z } from "zod";
import type { Connection, Database } from "../db/index.js";
import { ApiError } from "../errors.js";
import { gnpsTask } from "./spectrum.js";
import {
  REVIEW_RULE,
  metaText,
  ppmOf,
  reviewRow,
  type ReviewParameters,
} from "./review.js";

export const contextSchema = z.object({
  viewState: z
    .object({
      filter: z.string().max(500).optional(),
      sort: z.string().max(200).optional(),
    })
    .optional(),
  reportIds: z.array(z.string().uuid()).max(10).default([]),
  selectedRowIds: z.array(z.string().max(200)).max(300).default([]),
  scope: z.enum(["selection", "report", "project"]).default("selection"),
  expectedRevisions: z.record(z.number().int().positive()).default({}),
});
export type ContextSelection = z.infer<typeof contextSchema>;
export interface ContextReport {
  id: string;
  // GNPS2 task id when the report was imported from a task (for mirror plots).
  task?: string | null;
  title: string;
  revision: number;
  sourceUrl: string | null;
  parameters: unknown;
  rows: Record<string, any>[];
}
export interface ResearchContext {
  promptContext?: {
    initial: Record<string, any>;
    historyIncluded: number;
    historyOmitted: number;
    summaryVersion: number;
  };
  project: {
    id: string;
    name: string;
    research_goal: string;
    // Opt-in for lookup_compound, which sends InChIKey/SMILES to PubChem/NPClassifier.
    allow_external_lookup?: boolean;
  };
  session: { id: string; title: string };
  selection: ContextSelection;
  reports: ContextReport[];
}
const fields = [
  "id",
  "compoundName",
  "adduct",
  "mzTsv",
  "mzData",
  "rtTsv",
  "rtData",
  "rtDisplay",
  "deltaDa",
  "deltaPpm",
  "deltaRt",
  "candidateCount",
  "molecularFormula",
  "fragments",
  "reportedMzErrorPpm",
  "status",
  "sourceTsvRow",
  "sourceXlsxRow",
  "sourceMetadata",
] as const;
export function normalizeRow(row: Record<string, any>) {
  return Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));
}
export async function buildContext(
  db: Pick<Database | Connection, "query">,
  owner: string,
  sessionId: string,
  selection: ContextSelection,
): Promise<ResearchContext> {
  const session = (
    await db.query(
      `SELECT s.id,s.title,s.project_id,s.active_report_id,p.name,p.research_goal,p.allow_external_lookup FROM research_sessions s JOIN projects p ON p.id=s.project_id AND p.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND p.archived_at IS NULL AND s.status='active'`,
      [sessionId, owner],
    )
  ).rows[0];
  if (!session)
    throw new ApiError(404, "Không tìm thấy phiên nghiên cứu đang hoạt động.");
  let ids = selection.reportIds;
  if (!ids.length && selection.scope !== "project" && session.active_report_id)
    ids = [session.active_report_id];
  const records = (
    await db.query(
      `SELECT r.id,r.title,r.revision,r.source_url,r.data,COALESCE((SELECT jsonb_agg(rr.payload || jsonb_build_object('id',rr.source_row_id,'compoundName',rr.compound_name,'status',rr.status,'selected',rr.selected) ORDER BY rr.position) FROM report_rows rr WHERE rr.report_id=r.id),'[]'::jsonb) AS rows FROM reports r WHERE r.owner_id=$1 AND r.project_id=$2 AND (cardinality($3::uuid[])=0 OR r.id=ANY($3::uuid[])) ORDER BY r.id`,
      [owner, session.project_id, ids],
    )
  ).rows;
  if (ids.length && records.length !== new Set(ids).size)
    throw new ApiError(404, "Báo cáo không thuộc project này.");
  if (records.length > 10)
    throw new ApiError(400, "Hãy chọn tối đa 10 báo cáo cho một lượt.");
  if (!records.length)
    throw new ApiError(
      400,
      "Hãy thêm hoặc chọn báo cáo trong project trước khi chat.",
    );
  for (const r of records)
    if (
      selection.expectedRevisions[r.id] &&
      selection.expectedRevisions[r.id] !== r.revision
    )
      throw new ApiError(
        409,
        "Báo cáo đã thay đổi. Hãy tải lại để lấy đúng dữ liệu.",
        "AI_REVISION_CONFLICT",
      );
  const reports: ContextReport[] = records.map((r) => ({
    id: r.id,
    task: gnpsTask(r.data, r.source_url),
    title: r.title,
    revision: r.revision,
    sourceUrl: r.source_url,
    parameters: r.data.parameters,
    rows: r.rows.map(normalizeRow),
  }));
  if (
    selection.selectedRowIds.some(
      (id) => !reports.some((r) => r.rows.some((row) => row.id === id)),
    )
  )
    throw new ApiError(400, "Dòng đang chọn không còn trong báo cáo.");
  return {
    project: {
      id: session.project_id,
      name: session.name,
      research_goal: session.research_goal,
      allow_external_lookup: !!session.allow_external_lookup,
    },
    session: { id: session.id, title: session.title },
    selection,
    reports,
  };
}
export function summarize(report: ContextReport, rows = report.rows) {
  const ppm = rows
    .map((r) => r.reportedMzErrorPpm ?? r.deltaPpm)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return {
    reportId: report.id,
    title: report.title,
    revision: report.revision,
    totalRows: report.rows.length,
    examinedRows: rows.length,
    statusCounts: Object.fromEntries(
      ["matched", "ambiguous", "unmatched"].map((s) => [
        s,
        rows.filter((r) => r.status === s).length,
      ]),
    ),
    ppm: {
      count: ppm.length,
      maxAbsolute: ppm.length ? Math.max(...ppm.map(Math.abs)) : null,
      mean: ppm.length ? ppm.reduce((a, b) => a + b, 0) / ppm.length : null,
    },
    parameters: report.parameters,
  };
}
// Short refs keep UUIDs out of the prompt: R1 = first snapshot report, R1-12 = its 12th row.
export const reportRef = (reportIndex: number) => `R${reportIndex + 1}`;
export const rowRef = (reportIndex: number, rowIndex: number) =>
  `R${reportIndex + 1}-${rowIndex + 1}`;
export function resolveRef(ctx: ResearchContext, ref: string) {
  const m = /^R(\d{1,3})(?:-(\d{1,6}))?$/.exec(ref.trim());
  const reportIndex = m ? Number(m[1]) - 1 : -1,
    report = ctx.reports[reportIndex];
  if (!m || !report) return null;
  if (!m[2]) return { reportIndex, report, rowIndex: -1, row: undefined };
  const rowIndex = Number(m[2]) - 1,
    row = report.rows[rowIndex];
  return row ? { reportIndex, report, rowIndex, row } : null;
}
function findReport(ctx: ResearchContext, value?: string) {
  if (!value) return -1;
  const byId = ctx.reports.findIndex((r) => r.id === value);
  if (byId >= 0) return byId;
  const hit = resolveRef(ctx, value);
  return hit && !hit.row ? hit.reportIndex : -1;
}
// Library metadata the model can reason about; the rest of the GNPS row stays in the snapshot only.
const metadataKeys = new Set([
  "spectrumid",
  "mqscore",
  "sharedpeaks",
  "massdiff",
  "libmz",
  "specmz",
  "libraryqualitystring",
  "libraryclass",
  "ionmode",
  "instrument",
  "ionsource",
  "compoundsource",
  "organism",
  "smiles",
  "inchikey",
  "inchikeyplanar",
  "exactmass",
  "charge",
  "numberhits",
  "scan",
  "tags",
  "superclass",
  "class",
  "subclass",
  "npclassifierpathway",
  "npclassifiersuperclass",
  "npclassifierclass",
]);
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;
export function promptMetadata(meta: unknown, max = 160) {
  if (!meta || typeof meta !== "object") return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (
      !metadataKeys.has(k.toLowerCase().replace(/[^a-z0-9]/g, "")) ||
      v === null ||
      v === undefined ||
      v === ""
    )
      continue;
    out[k] = typeof v === "number" ? v : clip(String(v), max);
  }
  return Object.keys(out).length ? out : undefined;
}
const rowFields = fields.filter(
  (f) => f !== "id" && f !== "fragments" && f !== "sourceMetadata",
);
export function promptRow(
  ctx: ResearchContext,
  reportIndex: number,
  rowIndex: number,
  detail = false,
) {
  const report = ctx.reports[reportIndex],
    row = report.rows[rowIndex],
    out: Record<string, any> = {
      reportId: report.id,
      id: row.id,
      ref: rowRef(reportIndex, rowIndex),
    };
  for (const f of rowFields)
    if (row[f] !== null && row[f] !== undefined && row[f] !== "")
      out[f] = row[f];
  if (typeof row.fragments === "string" && row.fragments) {
    const max = detail ? 4000 : 240;
    out.fragments = clip(row.fragments, max);
    if (row.fragments.length > max) out.fragmentsTruncated = true;
  }
  const meta = promptMetadata(row.sourceMetadata, detail ? 500 : 160);
  if (meta) out.metadata = meta;
  return out;
}
// Serializes stored context/tool results for the provider: UUIDs become refs and row ids are dropped.
export function toPrompt(ctx: ResearchContext, value: unknown) {
  const refs = new Map(ctx.reports.map((r, i) => [r.id, reportRef(i)]));
  return JSON.stringify(value, function (this: any, key, v) {
    if (typeof this?.ref === "string" && (key === "id" || key === "reportId"))
      return undefined;
    if (
      (key === "reportId" || key === "otherReportId") &&
      typeof v === "string"
    )
      return refs.get(v) ?? v;
    return v;
  });
}
export function initialContext(ctx: ResearchContext, byteBudget: number) {
  const payload: any = {
    project: {
      name: ctx.project.name,
      research_goal: ctx.project.research_goal,
    },
    session: { title: ctx.session.title },
    scope: ctx.selection.scope,
    reports: ctx.reports.map((r) => summarize(r)),
    rows: [],
    examinedRows: 0,
    returnedRows: 0,
    truncated: false,
  };
  const candidates = ctx.reports.flatMap((r, reportIndex) =>
    r.rows.flatMap((row, rowIndex) =>
      ctx.selection.scope !== "selection" ||
      !ctx.selection.selectedRowIds.length ||
      ctx.selection.selectedRowIds.includes(row.id)
        ? [{ reportIndex, rowIndex }]
        : [],
    ),
  );
  payload.examinedRows = candidates.length;
  let size = Buffer.byteLength(toPrompt(ctx, payload));
  for (const c of candidates) {
    const row = promptRow(ctx, c.reportIndex, c.rowIndex),
      rowSize = Buffer.byteLength(toPrompt(ctx, row)) + 1;
    if (payload.rows.length >= 30 || size + rowSize > byteBudget) {
      payload.truncated = true;
      break;
    }
    payload.rows.push(row);
    size += rowSize;
  }
  payload.returnedRows = payload.rows.length;
  payload.reviewQueue = ctx.reports.flatMap((r, reportIndex) =>
    r.rows
      .map((row, i) => ({ i, review: reviewRow(row, r.parameters as any) }))
      .filter((x) => x.review.score >= 30)
      .sort((a, b) => b.review.score - a.review.score || a.i - b.i)
      .slice(0, 5)
      .map(({ i, review }) => ({
        reportId: r.id,
        id: r.rows[i].id,
        ref: rowRef(reportIndex, i),
        compoundName: r.rows[i].compoundName,
        ...review,
      })),
  );
  return payload;
}
const reportArg = {
    type: "string",
    description: "Report ref from context, e.g. R1.",
  },
  pageArgs = {
    offset: { type: "integer", minimum: 0, maximum: 10000 },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Default 20.",
    },
  },
  refArg = z.string().trim().min(1).max(200),
  page = {
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  };
const toolDefs = {
  get_project_overview: {
    description:
      "Project goal plus per-report summary (row count, status counts, ppm stats) computed over ALL rows of the snapshot. Use first for overview questions.",
    properties: {},
    required: [],
    schema: z.object({}).strict(),
  },
  list_project_reports: {
    description:
      "List reports in scope with ref, title, revision and row count.",
    properties: {},
    required: [],
    schema: z.object({}).strict(),
  },
  get_report_summary: {
    description:
      "Summary statistics of one report over all of its rows (status counts, ppm mean/max, matching parameters).",
    properties: { reportId: reportArg },
    required: ["reportId"],
    schema: z.object({ reportId: refArg }).strict(),
  },
  query_report_rows: {
    description:
      "Filter and sort rows of one report over ALL rows; returns matchingRows (exact count) and one page of compact rows with refs. Use for counting, finding high-ppm, ambiguous or unmatched rows.",
    properties: {
      reportId: reportArg,
      name: {
        type: "string",
        description: "Case-insensitive substring of the compound name.",
      },
      adduct: { type: "string", description: "Exact adduct, e.g. [M+H]+." },
      status: { type: "string", enum: ["matched", "ambiguous", "unmatched"] },
      minAbsolutePpm: {
        type: "number",
        minimum: 0,
        description: "Keep rows whose |ppm error| is at least this value.",
      },
      sort: {
        type: "string",
        enum: ["position", "abs_ppm_desc"],
        description: "Default position (report order).",
      },
      ...pageArgs,
    },
    required: ["reportId"],
    schema: z
      .object({
        reportId: refArg,
        name: z.string().max(200).optional(),
        adduct: z.string().max(100).optional(),
        status: z.enum(["matched", "ambiguous", "unmatched"]).optional(),
        minAbsolutePpm: z.number().nonnegative().optional(),
        sort: z.enum(["position", "abs_ppm_desc"]).default("position"),
        ...page,
      })
      .strict(),
  },
  get_compound_details: {
    description:
      "Full details of one row: all fields, full fragment list and library metadata (MQScore, SharedPeaks, SMILES, InChIKey, classes).",
    properties: {
      rowId: {
        type: "string",
        description: "Row ref from context, e.g. R1-12.",
      },
    },
    required: ["rowId"],
    schema: z.object({ rowId: refArg, reportId: refArg.optional() }).strict(),
  },
  compare_reports: {
    description:
      "Rows of report reportId that also appear in otherReportId, matched by library SpectrumID when present, otherwise normalized compound name. A name match does not establish chemical identity.",
    properties: {
      reportId: reportArg,
      otherReportId: reportArg,
      ...pageArgs,
    },
    required: ["reportId", "otherReportId"],
    schema: z
      .object({ reportId: refArg, otherReportId: refArg, ...page })
      .strict(),
  },
  get_review_queue: {
    description:
      "Rows ranked by a server-computed review score (0-100) with the reasons (ppm over tolerance, ambiguous/unmatched, several candidates, low MQScore, few SharedPeaks, RT offset, missing structure). Use for 'which rows should be checked first'. Explain the reasons; do not change the scores.",
    properties: {
      reportId: reportArg,
      minScore: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Default 30.",
      },
      ...pageArgs,
    },
    required: ["reportId"],
    schema: z
      .object({
        reportId: refArg,
        minScore: z.number().int().min(0).max(100).default(30),
        ...page,
      })
      .strict(),
  },
  aggregate_report: {
    description:
      "Group ALL rows of one report and return per-group counts and |ppm| mean/max, largest groups first, with a few example row refs.",
    properties: {
      reportId: reportArg,
      groupBy: {
        type: "string",
        enum: [
          "status",
          "adduct",
          "molecularFormula",
          "superclass",
          "pathway",
          "libraryClass",
        ],
      },
    },
    required: ["reportId", "groupBy"],
    schema: z
      .object({
        reportId: refArg,
        groupBy: z.enum([
          "status",
          "adduct",
          "molecularFormula",
          "superclass",
          "pathway",
          "libraryClass",
        ]),
      })
      .strict(),
  },
  distribution: {
    description:
      "Statistics and histogram of a numeric field over ALL rows of one report: ppm error, retention time (rt) or RT offset (deltaRt).",
    properties: {
      reportId: reportArg,
      field: { type: "string", enum: ["ppm", "rt", "deltaRt"] },
      bins: {
        type: "integer",
        minimum: 3,
        maximum: 20,
        description: "Default 8.",
      },
    },
    required: ["reportId", "field"],
    schema: z
      .object({
        reportId: refArg,
        field: z.enum(["ppm", "rt", "deltaRt"]),
        bins: z.number().int().min(3).max(20).default(8),
      })
      .strict(),
  },
  lookup_compound: {
    description:
      "External reference data for one row: PubChem (by the library InChIKey) and NPClassifier pathway/superclass/class (by SMILES). Only available when the project allows external lookup. This describes the library structure, not proof that it is in the sample.",
    properties: {
      rowId: {
        type: "string",
        description: "Row ref from context, e.g. R1-12.",
      },
    },
    required: ["rowId"],
    schema: z.object({ rowId: refArg, reportId: refArg.optional() }).strict(),
  },
  find_duplicates: {
    description:
      "Groups of rows in one report sharing the same compound name, library SpectrumID or molecular formula.",
    properties: {
      reportId: reportArg,
      by: { type: "string", enum: ["name", "spectrumId", "formula"] },
      ...pageArgs,
    },
    required: ["reportId", "by"],
    schema: z
      .object({
        reportId: refArg,
        by: z.enum(["name", "spectrumId", "formula"]),
        ...page,
      })
      .strict(),
  },
};
type ToolName = keyof typeof toolDefs;
export const toolNames = Object.keys(toolDefs) as ToolName[];
export const tools = toolNames.map((name) => ({
  type: "function",
  function: {
    name,
    description: `${toolDefs[name].description} Read-only, immutable snapshot in the selected scope; do not infer unseen rows.`,
    parameters: {
      type: "object",
      properties: toolDefs[name].properties,
      required: toolDefs[name].required,
      additionalProperties: false,
    },
  },
}));
// Row by ref (R1-12), or by reportId + row UUID for older callers.
function resolveRow(
  ctx: ResearchContext,
  args: { rowId: string; reportId?: string },
) {
  let hit = resolveRef(ctx, args.rowId);
  if (!hit?.row) {
    const reportIndex = findReport(ctx, args.reportId),
      rowIndex =
        reportIndex >= 0
          ? ctx.reports[reportIndex].rows.findIndex((r) => r.id === args.rowId)
          : -1;
    hit =
      rowIndex >= 0
        ? {
            reportIndex,
            report: ctx.reports[reportIndex],
            rowIndex,
            row: ctx.reports[reportIndex].rows[rowIndex],
          }
        : null;
  }
  if (!hit?.row)
    throw new ApiError(404, "Công cụ chỉ đọc dòng trong snapshot đã chọn.");
  return hit as NonNullable<typeof hit> & { row: Record<string, any> };
}
// Tools offered to the model for this context; external lookup is opt-in.
export function toolsFor(ctx: ResearchContext) {
  return ctx.project.allow_external_lookup
    ? tools
    : tools.filter((t) => t.function.name !== "lookup_compound");
}
// Validates lookup_compound arguments and returns the row it refers to.
export function lookupTarget(ctx: ResearchContext, raw: unknown) {
  if (!ctx.project.allow_external_lookup)
    throw new ApiError(
      403,
      "Project chưa cho phép tra cứu bên ngoài.",
      "AI_LOOKUP_DISABLED",
    );
  const args = toolDefs.lookup_compound.schema.parse(
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null))
      : raw,
  );
  const hit = resolveRow(ctx, args);
  return {
    row: hit.row,
    shown: {
      reportId: hit.report.id,
      id: hit.row.id,
      ref: rowRef(hit.reportIndex, hit.rowIndex),
      compoundName: hit.row.compoundName,
    },
  };
}
export function runTool(ctx: ResearchContext, name: string, raw: unknown) {
  if (!Object.hasOwn(toolDefs, name))
    throw new ApiError(400, "Công cụ không được phép.");
  // Some providers send null for omitted optional arguments.
  const cleaned =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null))
      : raw;
  const args: Record<string, any> =
    toolDefs[name as ToolName].schema.parse(cleaned);
  if (name === "get_project_overview")
    return {
      project: {
        name: ctx.project.name,
        research_goal: ctx.project.research_goal,
      },
      session: { title: ctx.session.title },
      reports: ctx.reports.map((r) => summarize(r)),
    };
  if (name === "list_project_reports")
    return ctx.reports.map((r) => ({
      reportId: r.id,
      title: r.title,
      revision: r.revision,
      rowCount: r.rows.length,
    }));
  if (name === "lookup_compound")
    throw new ApiError(400, "Tra cứu ngoài chạy bất đồng bộ qua lookupTarget.");
  if (name === "get_compound_details") {
    const hit = resolveRow(ctx, args as { rowId: string; reportId?: string });
    return {
      reportId: hit.report.id,
      revision: hit.report.revision,
      row: promptRow(ctx, hit.reportIndex, hit.rowIndex, true),
    };
  }
  const reportIndex = findReport(ctx, args.reportId),
    report = ctx.reports[reportIndex];
  if (!report)
    throw new ApiError(404, "Công cụ chỉ đọc báo cáo trong snapshot đã chọn.");
  if (name === "get_report_summary") return summarize(report);
  const params = (report.parameters ?? {}) as ReviewParameters,
    sample = (indexes: number[]) =>
      indexes.slice(0, 5).map((i) => ({
        reportId: report.id,
        id: report.rows[i].id,
        ref: rowRef(reportIndex, i),
      }));
  if (name === "get_review_queue") {
    const ranked = report.rows
      .map((row, i) => ({ i, review: reviewRow(row, params) }))
      .filter((x) => x.review.score >= args.minScore)
      .sort((a, b) => b.review.score - a.review.score || a.i - b.i);
    return {
      reportId: report.id,
      revision: report.revision,
      examinedRows: report.rows.length,
      flaggedRows: ranked.length,
      rule: REVIEW_RULE,
      offset: args.offset,
      rows: ranked
        .slice(args.offset, args.offset + args.limit)
        .map(({ i, review }) => ({
          ...promptRow(ctx, reportIndex, i),
          review,
        })),
      truncated: ranked.length > args.offset + args.limit,
    };
  }
  if (name === "aggregate_report") {
    const keyOf = (row: Record<string, any>) =>
      String(
        (args.groupBy === "superclass"
          ? metaText(row, "npclassifier_superclass", "superclass")
          : args.groupBy === "pathway"
            ? metaText(row, "npclassifier_pathway")
            : args.groupBy === "libraryClass"
              ? metaText(row, "Library_Class", "libraryclass")
              : row[args.groupBy]) ?? "",
      ).trim() || "(trống)";
    const groups = new Map<string, number[]>();
    report.rows.forEach((row, i) =>
      groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), i]),
    );
    const items = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, idx]) => {
        const ppm = idx
          .map((i) => ppmOf(report.rows[i]))
          .filter((v): v is number => v !== null)
          .map(Math.abs);
        return {
          key,
          count: idx.length,
          ppmMeanAbs: ppm.length
            ? Number((ppm.reduce((a, b) => a + b, 0) / ppm.length).toFixed(2))
            : null,
          ppmMaxAbs: ppm.length ? Math.max(...ppm) : null,
          examples: sample(idx),
        };
      });
    return {
      reportId: report.id,
      revision: report.revision,
      examinedRows: report.rows.length,
      groupBy: args.groupBy,
      groupCount: items.length,
      groups: items.slice(0, 30),
      truncated: items.length > 30,
    };
  }
  if (name === "distribution") {
    const valueOf = (row: Record<string, any>) => {
      const raw =
        args.field === "ppm"
          ? ppmOf(row)
          : args.field === "rt"
            ? (row.rtData ?? row.rtTsv)
            : row.deltaRt;
      // Missing values are reported as missing, never as 0.
      if (raw === null || raw === undefined || raw === "") return null;
      const v = Number(raw);
      return Number.isFinite(v) ? v : null;
    };
    const values = report.rows
      .map(valueOf)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const min = values[0],
      max = values[values.length - 1],
      width = values.length ? (max - min) / args.bins || 1 : 1;
    const bins = Array.from(
      { length: values.length ? args.bins : 0 },
      (_, k) => ({
        from: Number((min + k * width).toFixed(4)),
        to: Number((min + (k + 1) * width).toFixed(4)),
        count: 0,
      }),
    );
    for (const v of values)
      bins[Math.min(args.bins - 1, Math.floor((v - min) / width))].count++;
    return {
      reportId: report.id,
      revision: report.revision,
      field: args.field,
      examinedRows: report.rows.length,
      count: values.length,
      missing: report.rows.length - values.length,
      min: values.length ? min : null,
      max: values.length ? max : null,
      mean: values.length
        ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4))
        : null,
      median: values.length ? values[Math.floor(values.length / 2)] : null,
      bins,
    };
  }
  if (name === "find_duplicates") {
    const keyOf = (row: Record<string, any>) =>
      (args.by === "name"
        ? String(row.compoundName ?? "")
        : args.by === "formula"
          ? String(row.molecularFormula ?? "")
          : (metaText(row, "SpectrumID", "spectrum_id") ?? "")
      )
        .trim()
        .toLowerCase();
    const groups = new Map<string, number[]>();
    report.rows.forEach((row, i) => {
      const k = keyOf(row);
      if (k) groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    const dupes = [...groups.entries()]
      .filter(([, idx]) => idx.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    return {
      reportId: report.id,
      revision: report.revision,
      examinedRows: report.rows.length,
      by: args.by,
      duplicateGroups: dupes.length,
      offset: args.offset,
      groups: dupes
        .slice(args.offset, args.offset + args.limit)
        .map(([key, idx]) => ({ key, count: idx.length, rows: sample(idx) })),
      truncated: dupes.length > args.offset + args.limit,
    };
  }
  if (name === "compare_reports") {
    const otherIndex = findReport(ctx, args.otherReportId),
      other = ctx.reports[otherIndex];
    if (!other)
      throw new ApiError(404, "Báo cáo so sánh không thuộc snapshot.");
    const identity = (row: Record<string, any>) => {
      const meta = row.sourceMetadata ?? {};
      const library = meta.SpectrumID ?? meta.spectrum_id ?? meta.library_id;
      return library
        ? `library:${String(library)}`
        : `name:${String(row.compoundName ?? "")
            .trim()
            .toLowerCase()}`;
    };
    const right = new Map<string, number[]>();
    other.rows.forEach((row, i) => {
      const k = identity(row);
      right.set(k, [...(right.get(k) ?? []), i]);
    });
    const ref = (ri: number, i: number) => ({
      reportId: ctx.reports[ri].id,
      id: ctx.reports[ri].rows[i].id,
      ref: rowRef(ri, i),
    });
    const matched = report.rows
      .map((row, i) => ({ key: identity(row), i }))
      .filter((m) => m.key !== "name:" && right.has(m.key));
    return {
      reportId: report.id,
      revision: report.revision,
      otherReportId: other.id,
      otherRevision: other.revision,
      examinedRows: report.rows.length + other.rows.length,
      matchedLeftRows: matched.length,
      matchingRule:
        "library identifier when present, otherwise normalized name; name match does not establish chemical identity; no cross-unit numeric inference",
      items: matched.slice(args.offset, args.offset + args.limit).map((m) => ({
        key: m.key,
        left: ref(reportIndex, m.i),
        right: right.get(m.key)!.map((i) => ref(otherIndex, i)),
      })),
      truncated: matched.length > args.offset + args.limit,
    };
  }
  const matches = report.rows
    .map((row, i) => ({ row, i }))
    .filter(
      ({ row }) =>
        (!args.name ||
          String(row.compoundName)
            .toLowerCase()
            .includes(args.name.toLowerCase())) &&
        (!args.adduct || row.adduct === args.adduct) &&
        (!args.status || row.status === args.status) &&
        (args.minAbsolutePpm === undefined ||
          (ppmOf(row) !== null &&
            Math.abs(ppmOf(row)!) >= args.minAbsolutePpm)),
    );
  if (args.sort === "abs_ppm_desc")
    matches.sort(
      (a, b) =>
        (ppmOf(b.row) === null ? -1 : Math.abs(ppmOf(b.row)!)) -
        (ppmOf(a.row) === null ? -1 : Math.abs(ppmOf(a.row)!)),
    );
  return {
    reportId: report.id,
    revision: report.revision,
    examinedRows: report.rows.length,
    matchingRows: matches.length,
    offset: args.offset,
    rows: matches
      .slice(args.offset, args.offset + args.limit)
      .map(({ i }) => promptRow(ctx, reportIndex, i)),
    truncated: matches.length > args.offset + args.limit,
  };
}
// Every row object handed to the model carries reportId + id + ref.
function shownRows(value: unknown, out: { reportId: string; id: string }[]) {
  if (Array.isArray(value)) for (const v of value) shownRows(v, out);
  else if (value && typeof value === "object") {
    const v = value as Record<string, any>;
    if (
      typeof v.ref === "string" &&
      typeof v.id === "string" &&
      typeof v.reportId === "string"
    )
      out.push({ reportId: v.reportId, id: v.id });
    for (const child of Object.values(v))
      if (child && typeof child === "object") shownRows(child, out);
  }
  return out;
}
export function sourceReferences(
  ctx: ResearchContext,
  toolRuns: { result: Record<string, any> }[] = [],
) {
  const shown = shownRows(
    [ctx.promptContext?.initial.rows ?? [], toolRuns.map((t) => t.result)],
    [],
  );
  return ctx.reports.map((r) => ({
    reportId: r.id,
    title: r.title,
    revision: r.revision,
    rowIds: [
      ...new Set(
        [
          ...(ctx.promptContext ? [] : ctx.selection.selectedRowIds),
          ...shown.filter((s) => s.reportId === r.id).map((s) => s.id),
        ].filter((id) => r.rows.some((row) => row.id === id)),
      ),
    ].slice(0, 50),
  }));
}
export interface Citation {
  ref: string;
  reportId: string | null;
  rowId: string | null;
  status: "ok" | "unseen" | "invalid";
}
const citationPattern =
  /\[(R\d{1,3}(?:-\d{1,6})?(?:\s*[,;]\s*R\d{1,3}(?:-\d{1,6})?)*)\]/g;
const splitRefs = (group: string) => group.split(/\s*[,;]\s*/);
// "unseen" = the row exists in the snapshot but was never given to the model, so the claim is unsupported.
export function validateCitations(
  ctx: ResearchContext,
  content: string,
  toolResults: unknown[] = [],
): Citation[] {
  const seen = new Set(
    shownRows([ctx.promptContext?.initial.rows ?? [], toolResults], []).map(
      (s) => `${s.reportId}:${s.id}`,
    ),
  );
  const refs = [
    ...new Set(
      [...content.matchAll(citationPattern)].flatMap((m) => splitRefs(m[1])),
    ),
  ].slice(0, 200);
  return refs.map((ref) => {
    const hit = resolveRef(ctx, ref);
    if (!hit) return { ref, reportId: null, rowId: null, status: "invalid" };
    if (!hit.row)
      return { ref, reportId: hit.report.id, rowId: null, status: "ok" };
    return {
      ref,
      reportId: hit.report.id,
      rowId: hit.row.id,
      status: seen.has(`${hit.report.id}:${hit.row.id}`) ? "ok" : "unseen",
    };
  });
}
// Refs are per snapshot; rewrite an older answer's refs into the current snapshot before reusing it as history.
export function remapCitations(
  content: string,
  citations: Citation[] | null | undefined,
  ctx: ResearchContext,
) {
  if (!citations?.length) return content;
  const old = new Map(citations.map((c) => [c.ref, c]));
  return content.replace(citationPattern, (_match, group: string) => {
    const refs = splitRefs(group).flatMap((ref) => {
      const c = old.get(ref),
        ri = c?.reportId
          ? ctx.reports.findIndex((r) => r.id === c.reportId)
          : -1;
      if (!c || ri < 0) return [];
      if (!c.rowId) return [reportRef(ri)];
      const rowIndex = ctx.reports[ri].rows.findIndex((r) => r.id === c.rowId);
      return rowIndex < 0 ? [] : [rowRef(ri, rowIndex)];
    });
    return refs.length
      ? `[${refs.join(", ")}]`
      : "[nguồn ngoài phạm vi hiện tại]";
  });
}
interface ReadableReport {
  id: string;
  title: string;
  rows: Record<string, any>[];
}
// For exports read outside the app: [R1-12] -> [Report title · dòng TSV 12 (compound)].
export function readableCitations(
  content: string,
  citations: Citation[] | null | undefined,
  reports: ReadableReport[],
) {
  if (!citations?.length) return content;
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  return content.replace(citationPattern, (_match, group: string) => {
    const parts = splitRefs(group).map((ref) => {
      const c = byRef.get(ref),
        report = c?.reportId
          ? reports.find((r) => r.id === c.reportId)
          : undefined;
      if (!c || !report) return `${ref} (không tồn tại)`;
      if (!c.rowId) return report.title;
      const row = report.rows.find((r) => r.id === c.rowId);
      return `${report.title} · ${row?.sourceTsvRow ? `dòng TSV ${row.sourceTsvRow}` : `dòng ${ref}`}${row?.compoundName ? ` (${row.compoundName})` : ""}`;
    });
    return `[${parts.join("; ")}]`;
  });
}
// Starter questions derived from the rows in scope, so they point at real issues.
export function suggestQuestions(ctx: ResearchContext) {
  const selected = ctx.selection.selectedRowIds,
    inScope = ctx.reports.flatMap((r) =>
      ctx.selection.scope === "selection" && selected.length
        ? r.rows.filter((row) => selected.includes(row.id))
        : r.rows,
    ),
    out: string[] = [];
  if (
    ctx.selection.scope === "selection" &&
    selected.length === 1 &&
    inScope[0]
  )
    out.push(
      `Đánh giá độ tin cậy định danh của ${inScope[0].compoundName ?? "dòng đang chọn"}`,
    );
  const highPpm = inScope.filter((r) => {
    const v = ppmOf(r);
    return v !== null && Math.abs(v) > 10;
  }).length;
  if (highPpm) out.push(`Vì sao ${highPpm} dòng có sai số trên 10 ppm?`);
  const ambiguous = inScope.filter((r) => r.status === "ambiguous").length;
  if (ambiguous)
    out.push(`Giải thích ${ambiguous} dòng ambiguous và cách xác minh`);
  const unmatched = inScope.filter((r) => r.status === "unmatched").length;
  if (unmatched) out.push(`${unmatched} dòng chưa khớp: nên kiểm tra gì?`);
  if (ctx.reports.length >= 2)
    out.push(`So sánh ${ctx.reports[0].title} và ${ctx.reports[1].title}`);
  out.push(
    "Dòng nào nên duyệt lại trước?",
    "Soạn nháp mục Kết quả và thảo luận cho báo cáo",
  );
  return [...new Set(out)].slice(0, 4);
}
// One owned report with normalized rows, outside any research session.
export async function loadReport(
  db: Pick<Database | Connection, "query">,
  owner: string,
  reportId: string,
): Promise<ContextReport> {
  const r = (
    await db.query(
      `SELECT r.id,r.title,r.revision,r.source_url,r.data,COALESCE((SELECT jsonb_agg(rr.payload || jsonb_build_object('id',rr.source_row_id,'compoundName',rr.compound_name,'status',rr.status,'selected',rr.selected) ORDER BY rr.position) FROM report_rows rr WHERE rr.report_id=r.id),'[]'::jsonb) AS rows FROM reports r WHERE r.owner_id=$1 AND r.id=$2`,
      [owner, reportId],
    )
  ).rows[0];
  if (!r) throw new ApiError(404, "Không tìm thấy báo cáo.");
  return {
    id: r.id,
    task: gnpsTask(r.data, r.source_url),
    title: r.title,
    revision: r.revision,
    sourceUrl: r.source_url,
    parameters: r.data.parameters,
    rows: r.rows.map(normalizeRow),
  };
}
export function reviewQueue(report: ContextReport, limit = 10, minScore = 30) {
  const ranked = report.rows
    .map((row, i) => ({
      i,
      row,
      review: reviewRow(row, (report.parameters ?? {}) as ReviewParameters),
    }))
    .filter((x) => x.review.score >= minScore)
    .sort((a, b) => b.review.score - a.review.score || a.i - b.i);
  return {
    reportId: report.id,
    revision: report.revision,
    examinedRows: report.rows.length,
    flaggedRows: ranked.length,
    rule: REVIEW_RULE,
    items: ranked.slice(0, limit).map(({ row, review }) => ({
      rowId: row.id,
      compoundName: row.compoundName,
      sourceTsvRow: row.sourceTsvRow,
      status: row.status,
      ...review,
    })),
  };
}
