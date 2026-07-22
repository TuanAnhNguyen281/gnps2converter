import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';

export type PreviewValue = string | number | null;
export interface FilePreview {
  fileName: string;
  fileType: 'tsv' | 'xlsx';
  sheets: string[];
  activeSheet: string;
  columns: string[];
  rows: PreviewValue[][];
  totalRows: number;
  previewLimited: boolean;
}

export const PREVIEW_LIMIT = 1_000;

function uniqueHeaders(values: unknown[]) {
  const used = new Map<string, number>();
  return values.map((value, index) => {
    const base = String(value ?? '').trim() || `Cột ${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function displayValue(cell: ExcelJS.Cell): PreviewValue {
  if (cell.value == null) return null;
  if (typeof cell.value === 'number') return cell.value;
  if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return cell.text || String(cell.value);
}

export function previewTsv(buffer: Buffer, fileName: string): FilePreview {
  const matrix = parse(buffer, {
    delimiter: '\t', bom: true, skip_empty_lines: true, relax_column_count: true, trim: true,
  }) as unknown[][];
  const columns = uniqueHeaders(matrix[0] ?? []);
  const dataRows = matrix.slice(1).filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
  return {
    fileName, fileType: 'tsv', sheets: [], activeSheet: '', columns,
    rows: dataRows.slice(0, PREVIEW_LIMIT).map((row) => columns.map((_, index) => {
      const value = row[index]; return value == null || value === '' ? null : String(value);
    })),
    totalRows: dataRows.length, previewLimited: dataRows.length > PREVIEW_LIMIT,
  };
}

export async function previewXlsx(buffer: Buffer, fileName: string, requestedSheet = ''): Promise<FilePreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(requestedSheet) ?? workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook không có sheet dữ liệu.');
  const width = Math.max(1, sheet.columnCount);
  const columns = uniqueHeaders(Array.from({ length: width }, (_, index) => sheet.getRow(1).getCell(index + 1).text));
  const rows: PreviewValue[][] = [];
  let totalRows = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = columns.map((_, index) => displayValue(row.getCell(index + 1)));
    if (!values.some((value) => value !== null && String(value).trim() !== '')) return;
    totalRows += 1;
    if (rows.length < PREVIEW_LIMIT) rows.push(values);
  });
  return {
    fileName, fileType: 'xlsx', sheets: workbook.worksheets.map((item) => item.name), activeSheet: sheet.name,
    columns, rows, totalRows, previewLimited: totalRows > PREVIEW_LIMIT,
  };
}
