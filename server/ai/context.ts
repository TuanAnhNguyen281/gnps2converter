import { z } from "zod";
import type { Connection, Database } from "../db/index.js";
import { ApiError } from "../errors.js";

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
  project: { id: string; name: string; research_goal: string };
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
      `SELECT s.id,s.title,s.project_id,s.active_report_id,p.name,p.research_goal FROM research_sessions s JOIN projects p ON p.id=s.project_id AND p.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND p.archived_at IS NULL AND s.status='active'`,
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
export function initialContext(ctx: ResearchContext, byteBudget: number) {
  const payload: any = {
    project: ctx.project,
    session: ctx.session,
    scope: ctx.selection.scope,
    reports: ctx.reports.map((r) => summarize(r)),
    rows: [],
    examinedRows: 0,
    returnedRows: 0,
    truncated: false,
  };
  const candidates = ctx.reports.flatMap((r) =>
    r.rows
      .filter(
        (row) =>
          ctx.selection.scope !== "selection" ||
          !ctx.selection.selectedRowIds.length ||
          ctx.selection.selectedRowIds.includes(row.id),
      )
      .map((row) => ({ reportId: r.id, revision: r.revision, ...row })),
  );
  payload.examinedRows = candidates.length;
  for (const row of candidates) {
    if (
      payload.rows.length >= 30 ||
      Buffer.byteLength(JSON.stringify(payload)) +
        Buffer.byteLength(JSON.stringify(row)) >
        byteBudget
    ) {
      payload.truncated = true;
      break;
    }
    payload.rows.push(row);
  }
  payload.returnedRows = payload.rows.length;
  return payload;
}
const toolSchema = z
  .object({
    reportId: z.string().uuid().optional(),
    otherReportId: z.string().uuid().optional(),
    rowId: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    status: z.enum(["matched", "ambiguous", "unmatched"]).optional(),
    minAbsolutePpm: z.number().nonnegative().optional(),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const toolNames = [
  "get_project_overview",
  "list_project_reports",
  "get_report_summary",
  "query_report_rows",
  "get_compound_details",
  "compare_reports",
] as const;
export const tools = toolNames.map((name) => ({
  type: "function",
  function: {
    name,
    description: `Read immutable project snapshot: ${name}. reportId must come from supplied context. Results include revision and counts; do not infer unseen rows.`,
    parameters: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        otherReportId: { type: "string" },
        rowId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["matched", "ambiguous", "unmatched"] },
        minAbsolutePpm: { type: "number" },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
}));
export function runTool(ctx: ResearchContext, name: string, raw: unknown) {
  if (!toolNames.includes(name as (typeof toolNames)[number]))
    throw new ApiError(400, "Công cụ không được phép.");
  const args = toolSchema.parse(raw);
  if (name === "get_project_overview")
    return {
      project: ctx.project,
      session: ctx.session,
      reports: ctx.reports.map((r) => summarize(r)),
    };
  if (name === "list_project_reports")
    return ctx.reports.map((r) => ({
      id: r.id,
      title: r.title,
      revision: r.revision,
      rowCount: r.rows.length,
    }));
  const report = ctx.reports.find((r) => r.id === args.reportId);
  if (!report)
    throw new ApiError(404, "Công cụ chỉ đọc báo cáo trong snapshot đã chọn.");
  if (name === "get_report_summary") return summarize(report);
  if (name === "compare_reports") {
    const other = ctx.reports.find((r) => r.id === args.otherReportId);
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
    const right = new Map<string, Record<string, any>[]>();
    for (const row of other.rows) {
      const k = identity(row);
      right.set(k, [...(right.get(k) ?? []), row]);
    }
    const matched = report.rows.filter(
      (row) => identity(row) !== "name:" && right.has(identity(row)),
    );
    return {
      reportId: report.id,
      revision: report.revision,
      otherReportId: other.id,
      otherRevision: other.revision,
      examinedRows: report.rows.length + other.rows.length,
      matchedLeftRows: matched.length,
      matchingRule:
        "library identifier when present, otherwise normalized name; name match does not establish chemical identity; no cross-unit numeric inference",
      items: matched
        .slice(args.offset, args.offset + args.limit)
        .map((row) => ({
          key: identity(row),
          leftRowId: row.id,
          rightRowIds: right.get(identity(row))!.map((r) => r.id),
        })),
      truncated: matched.length > args.offset + args.limit,
    };
  }
  const rows = report.rows.filter(
    (row) =>
      (!args.rowId || row.id === args.rowId) &&
      (!args.name ||
        String(row.compoundName)
          .toLowerCase()
          .includes(args.name.toLowerCase())) &&
      (!args.status || row.status === args.status) &&
      (args.minAbsolutePpm === undefined ||
        (typeof (row.reportedMzErrorPpm ?? row.deltaPpm) === "number" &&
          Math.abs(row.reportedMzErrorPpm ?? row.deltaPpm) >=
            args.minAbsolutePpm)),
  );
  return {
    reportId: report.id,
    revision: report.revision,
    examinedRows: report.rows.length,
    matchingRows: rows.length,
    offset: args.offset,
    rows: rows.slice(args.offset, args.offset + args.limit),
    truncated: rows.length > args.offset + args.limit,
  };
}
export function sourceReferences(
  ctx: ResearchContext,
  toolRuns: { result: Record<string, any> }[] = [],
) {
  return ctx.reports.map((r) => ({
    reportId: r.id,
    title: r.title,
    revision: r.revision,
    rowIds: [
      ...new Set(
        [
          ...(ctx.promptContext ? [] : ctx.selection.selectedRowIds),
          ...(ctx.promptContext?.initial.rows ?? [])
            .filter((row: any) => row.reportId === r.id)
            .map((row: any) => row.id),
          ...toolRuns.flatMap((t) =>
            t.result.reportId === r.id
              ? (t.result.rows ?? []).map((row: any) => row.id)
              : [],
          ),
        ].filter((id) => r.rows.some((row) => row.id === id)),
      ),
    ].slice(0, 50),
  }));
}
