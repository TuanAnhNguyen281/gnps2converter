import { z } from "zod";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";
const text = z.string().max(4000),
  n = z.number().finite();
export const rowSchema = z.object({
  id: z.string().min(1).max(100),
  selected: z.boolean(),
  sourceTsvRow: n.int().nonnegative(),
  sourceXlsxRow: n.int().nonnegative(),
  compoundName: text,
  adduct: text,
  mzTsv: n,
  mzData: n,
  rtTsv: n,
  rtData: n,
  rtDisplay: text,
  deltaDa: n,
  deltaPpm: n,
  deltaRt: n,
  candidateCount: n.int().nonnegative(),
  molecularFormula: text,
  fragments: z.string().max(100000),
  reportedMzErrorPpm: n.nullable(),
  sourceMetadata: z.record(z.union([text, n, z.null()])),
  status: z.enum(["matched", "ambiguous", "unmatched"]),
  structureData: z.string().max(3_000_000).optional(),
  structureUrl: z.string().max(2000).optional(),
});
export const resultSchema = z.object({
  source: z.enum(["files", "gnps-task"]).optional(),
  task: z.string().max(100).optional(),
  title: z.string().max(160).optional(),
  rows: z.array(rowSchema).max(10000),
  mapping: z.object({
    compoundName: text,
    adduct: text,
    precursorMz: text,
    formula: text,
    reportedPpm: text,
    fragments: text,
    excelCompoundName: text,
    excelRt: text,
  }),
  tsvHeaders: z.array(text).max(500),
  excelHeaders: z.array(text).max(500),
  sheets: z.array(text).max(100),
  summary: z.record(n.nonnegative()),
  parameters: z.object({
    mzMode: z.enum(["ppm", "da"]),
    mzTolerance: n.nonnegative(),
    rtTolerance: n.nonnegative(),
  }),
});
export type Result = z.infer<typeof resultSchema>;
export function validateResult(value: unknown, config: Config) {
  const result = resultSchema.parse(value);
  if (result.rows.length > config.maxRows)
    throw new ApiError(
      413,
      `Báo cáo vượt ${config.maxRows} dòng.`,
      "ROW_LIMIT",
    );
  if (new Set(result.rows.map((r) => r.id)).size !== result.rows.length)
    throw new ApiError(400, "ID dòng bị trùng.");
  for (const row of result.rows)
    if (Object.keys(row.sourceMetadata).length > 500)
      throw new ApiError(413, "Quá nhiều trường metadata.");
  const clean = {
    ...result,
    rows: result.rows.map(
      ({ structureData: _image, structureUrl: _url, ...r }) => r,
    ),
  };
  const bytes = Buffer.byteLength(JSON.stringify(clean));
  if (bytes > config.maxJsonBytes)
    throw new ApiError(413, "Dữ liệu báo cáo vượt quota JSON.", "JSON_LIMIT");
  return { result, bytes };
}
