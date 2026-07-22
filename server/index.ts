import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parse } from 'csv-parse/sync';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { z } from 'zod';
import { aliases, guessColumn, matchRows } from './matching.js';
import { importGnpsTask } from './gnps-task.js';
import { previewTsv, previewXlsx } from './file-preview.js';
import type { ColumnMapping, MatchRow, RawRow } from './types.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 3 },
});
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

function safeName(input: string) {
  return input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim().slice(0, 100) || 'report';
}

function contentDisposition(fileName: string) {
  const asciiName = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_') || 'report';
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function rowsFromWorksheet(worksheet: ExcelJS.Worksheet): { headers: string[]; rows: RawRow[] } {
  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = String(cell.text ?? '').trim() || `Column_${column}`;
  });
  const rows: RawRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: RawRow = {};
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      item[header] = typeof cell.value === 'number' ? cell.value : cell.text;
    });
    if (Object.values(item).some((value) => value !== '' && value != null)) rows.push(item);
  });
  return { headers, rows };
}

function parseTsv(buffer: Buffer): { headers: string[]; rows: RawRow[] } {
  const matrix = parse(buffer, { delimiter: '\t', bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0].map((header, index) => {
    const clean = String(header ?? '').trim();
    if (clean) return clean;
    if (index === matrix[0].length - 2) return 'mz_fragments';
    if (index === matrix[0].length - 1) return 'rt_vn';
    return `unnamed_${index + 1}`;
  });
  const rows = matrix.slice(1)
    .filter((row) => row.some((value) => String(value ?? '').trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
  return { headers, rows };
}

const mappingSchema = z.object({
  compoundName: z.string(), adduct: z.string(), precursorMz: z.string().min(1), formula: z.string(),
  reportedPpm: z.string(), fragments: z.string(),
  excelCompoundName: z.string().min(1), excelRt: z.string().min(1),
});

app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'gnps2-api' }));

app.post('/api/files/preview', upload.single('file'), async (request, response, next) => {
  try {
    const file = request.file;
    if (!file) return response.status(400).json({ message: 'Hãy chọn file cần xem.' });
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.tsv')) return response.json(previewTsv(file.buffer, file.originalname));
    if (name.endsWith('.xlsx')) return response.json(await previewXlsx(file.buffer, file.originalname, String(request.body.sheetName ?? '')));
    return response.status(400).json({ message: 'Trình xem chỉ hỗ trợ file .tsv và .xlsx.' });
  } catch (error) { next(error); }
});

app.post('/api/gnps-task/import', async (request, response, next) => {
  const input = z.object({ url: z.string().trim().min(1).max(2_000) }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ message: 'Hãy nhập link GNPS2 Task hợp lệ.' });
  try {
    const imported = await importGnpsTask(input.data.url);
    const emptyMapping: ColumnMapping = {
      compoundName: 'Compound_Name', adduct: 'Adduct', precursorMz: 'SpecMZ', formula: 'molecular_formula',
      reportedPpm: 'MZErrorPPM', fragments: 'specs_ms.mgf', excelCompoundName: 'library_compound_name', excelRt: 'rt_min',
    };
    return response.json({
      title: imported.metadata.title, task: imported.task, source: 'gnps-task', rows: imported.rows,
      mapping: emptyMapping, tsvHeaders: imported.libraryHeaders,
      excelHeaders: ['id', 'mz', 'rt', 'rt_min', 'charge', 'library_compound_name', 'library_SMILES', 'library_InChI'], sheets: [],
      summary: {
        tsvRows: imported.rows.length, dataRows: imported.graphNodes, matched: imported.graphMatched,
        unmatched: imported.rows.filter((row) => row.status === 'unmatched').length,
        invalidTsv: 0, invalidData: 0, rtFallback: imported.rtFallback,
        structures: imported.structures, fragments: imported.fragments,
      },
      parameters: { mzMode: 'ppm', mzTolerance: 0, rtTolerance: 0 },
    });
  } catch (error) { next(error); }
});

app.post('/api/analyze', upload.fields([{ name: 'tsv', maxCount: 1 }, { name: 'xlsx', maxCount: 1 }]), async (request, response, next) => {
  try {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const tsv = files?.tsv?.[0];
    const xlsx = files?.xlsx?.[0];
    if (!tsv || !xlsx) return response.status(400).json({ message: 'Cần chọn đủ file TSV và XLSX.' });
    if (!tsv.originalname.toLowerCase().endsWith('.tsv') || !xlsx.originalname.toLowerCase().endsWith('.xlsx')) {
      return response.status(400).json({ message: 'Định dạng không hợp lệ. Chỉ chấp nhận .tsv và .xlsx.' });
    }

    const parsedTsv = parseTsv(tsv.buffer);
    const tsvRows = parsedTsv.rows;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.buffer as unknown as ExcelJS.Buffer);
    const sheetName = String(request.body.sheetName ?? '');
    const worksheet = workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];
    if (!worksheet) return response.status(400).json({ message: 'Workbook không có sheet dữ liệu.' });
    const excel = rowsFromWorksheet(worksheet);
    const tsvHeaders = parsedTsv.headers;

    let mapping: ColumnMapping;
    if (request.body.mapping) mapping = mappingSchema.parse(JSON.parse(String(request.body.mapping)));
    else mapping = {
      compoundName: guessColumn(tsvHeaders, 'compoundName'), adduct: guessColumn(tsvHeaders, 'adduct'),
      precursorMz: guessColumn(tsvHeaders, 'precursorMz'), formula: guessColumn(tsvHeaders, 'formula'),
      reportedPpm: guessColumn(tsvHeaders, 'reportedPpm'), fragments: guessColumn(tsvHeaders, 'fragments'),
      excelCompoundName: guessColumn(excel.headers, 'excelCompoundName'), excelRt: guessColumn(excel.headers, 'excelRt'),
    };

    const missing = ['compoundName', 'precursorMz', 'excelCompoundName', 'excelRt'].filter((key) => !mapping[key as keyof ColumnMapping]);
    if (missing.length) return response.status(422).json({
      code: 'COLUMN_MAPPING_REQUIRED', message: 'Không thể tự nhận diện đủ cột bắt buộc.', missing,
      tsvHeaders, excelHeaders: excel.headers, sheets: workbook.worksheets.map((sheet) => sheet.name), mapping,
    });

    const mzMode = request.body.mzMode === 'da' ? 'da' : 'ppm';
    const mzTolerance = Number(request.body.mzTolerance ?? 10);
    const rtTolerance = Number(request.body.rtTolerance ?? 0.5);
    if (!(mzTolerance > 0) || !(rtTolerance > 0)) return response.status(400).json({ message: 'Tolerance phải lớn hơn 0.' });
    const result = matchRows(tsvRows, excel.rows, mapping, { mzMode, mzTolerance, rtTolerance });
    const { rows, ...diagnostics } = result;
    return response.json({
      rows: result.rows, mapping, tsvHeaders, excelHeaders: excel.headers,
      sheets: workbook.worksheets.map((sheet) => sheet.name),
      summary: { tsvRows: tsvRows.length, dataRows: excel.rows.length, ...diagnostics },
      parameters: { mzMode, mzTolerance, rtTolerance },
    });
  } catch (error) { next(error); }
});

const exportSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  title: z.string().trim().min(1).max(160).optional(),
  fileName: z.string().optional(),
});

function formatNumber(value: unknown, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: digits }) : '';
}

function formatMolecularFormula(value: unknown) {
  const subscripts: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  };
  return String(value ?? '').replace(/\d/g, (digit) => subscripts[digit]);
}

function reportRows(input: Record<string, unknown>[]) {
  // Carbone keeps the template's sample picture when an image tag receives an
  // empty string. A transparent 1x1 PNG makes the Word cell visually blank.
  const blankStructure = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcO7WQAAAABJRU5ErkJggg==';
  return input.filter((row) => row.selected !== false).map((row, index) => ({
    stt: index + 1, rt: String(row.rtDisplay ?? formatNumber(row.rtTsv ?? row.rtData, 3)).replace('.', ','), ten_hoat_chat: String(row.compoundName ?? ''),
    ion: String(row.adduct ?? ''), mz_precursor: formatNumber(row.mzTsv, 5),
    mz_fragments: String(row.fragments ?? ''), cong_thuc: formatMolecularFormula(row.molecularFormula),
    sai_so_ppm: formatNumber(row.reportedMzErrorPpm ?? row.deltaPpm, 5),
    cau_truc: String(row.structureData || blankStructure),
  }));
}

async function fallbackDocx(rows: ReturnType<typeof reportRows>, title: string) {
  const headers = ['STT', 'RT', 'Tên hoạt chất', 'Ion', 'm/z precursor', 'm/z fragments', 'Công thức', 'Sai số ppm'];
  const borders = { style: BorderStyle.SINGLE, size: 1, color: '9CB6C5' };
  const tableRows = [
    new TableRow({ tableHeader: true, children: headers.map((value) => new TableCell({
      shading: { fill: 'D9EEF2' }, borders: { top: borders, bottom: borders, left: borders, right: borders },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: value, bold: true, color: '083344' })] })],
    })) }),
    ...rows.map((row) => new TableRow({ children: [row.stt, row.rt, row.ten_hoat_chat, row.ion, row.mz_precursor, row.mz_fragments, row.cong_thuc, row.sai_so_ppm].map((value) => new TableCell({
      borders: { top: borders, bottom: borders, left: borders, right: borders },
      children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 20 })] })],
    })) })),
  ];
  const document = new Document({ sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true, color: '075985' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Ngày xuất: ${new Date().toLocaleString('vi-VN')}`, italics: true })] }),
    new Paragraph(''), new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),
  ] }] });
  return Packer.toBuffer(document);
}

async function injectStructureImages(docx: Buffer, rows: ReturnType<typeof reportRows>) {
  const zip = await JSZip.loadAsync(docx);
  const documentPart = zip.file('word/document.xml');
  const relationsPart = zip.file('word/_rels/document.xml.rels');
  if (!documentPart || !relationsPart) return docx;
  let documentXml = await documentPart.async('string');
  let relationsXml = await relationsPart.async('string');
  let rowIndex = 0;
  documentXml = documentXml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, (tableRow) => {
    if (!tableRow.includes('<w:drawing>') || rowIndex >= rows.length) return tableRow;
    const dataUri = rows[rowIndex].cau_truc;
    const match = dataUri.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
    const currentIndex = rowIndex++;
    if (!match) return tableRow;
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const relationId = `rIdGnpsStructure${currentIndex + 1}`;
    const mediaName = `gnps-structure-${currentIndex + 1}.${extension}`;
    zip.file(`word/media/${mediaName}`, Buffer.from(match[2], 'base64'));
    relationsXml = relationsXml.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`);
    return tableRow.replace(/(<a:blip\b[^>]*?r:embed=")[^"]+("[^>]*>)/, `$1${relationId}$2`);
  });
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relationsXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

app.post('/api/export/docx', async (request, response, next) => {
  try {
    const body = exportSchema.parse(request.body);
    const rows = reportRows(body.rows);
    const title = body.title ?? 'BÁO CÁO KẾT QUẢ PHÂN TÍCH';
    const template = path.join(root, 'templates', 'report-template.docx');
    let output: Buffer;
    if (existsSync(template)) {
      const carbone = require('carbone') as { render: (template: string, data: unknown, callback: (error: Error | null, result: Buffer) => void) => void };
      output = await new Promise((resolve, reject) => carbone.render(template, { title, rows }, (error, result) => error ? reject(error) : resolve(result)));
      output = await injectStructureImages(output, rows);
    } else output = await fallbackDocx(rows, title);
    const name = safeName(body.fileName ?? title);
    response.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': contentDisposition(`${name}.docx`) });
    response.send(output);
  } catch (error) { next(error); }
});

app.post('/api/structures/gnps2', async (request, response) => {
  const input = z.object({
    url: z.string().url(),
    rows: z.array(z.object({ id: z.string(), compoundName: z.string().min(1) })).max(200),
  }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ message: 'URL GNPS2 hoặc danh sách hợp chất không hợp lệ.' });
  let resultUrl: URL;
  try { resultUrl = new URL(input.data.url); } catch { return response.status(400).json({ message: 'URL GNPS2 không hợp lệ.' }); }
  if (!['gnps2.org', 'www.gnps2.org'].includes(resultUrl.hostname.toLowerCase())) return response.status(400).json({ message: 'Chỉ chấp nhận URL kết quả từ gnps2.org.' });
  const task = resultUrl.searchParams.get('task') ?? '';
  if (!/^[a-f0-9]{32}$/i.test(task)) return response.status(400).json({ message: 'Không tìm thấy Task ID GNPS2 hợp lệ trong URL.' });
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
  let libraryRows: Array<Record<string, unknown>>;
  try {
    const gnpsResponse = await fetch(`https://www.gnps2.org/result?json=&task=${task}&viewname=librarymatches`, { signal: controller.signal });
    if (!gnpsResponse.ok) throw new Error(`GNPS2 HTTP ${gnpsResponse.status}`);
    libraryRows = await gnpsResponse.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(libraryRows)) throw new Error('GNPS2 response is not an array');
  } catch (error) {
    clearTimeout(timeout);
    return response.status(502).json({ message: `Không thể đọc Library Matches từ GNPS2: ${error instanceof Error ? error.message : 'unknown error'}` });
  }
  clearTimeout(timeout);
  const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_/\\()[\]{}+,:;"']/g, ' ').replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
  const resolved: Array<{ id: string; status: 'found'|'not_found'|'error'; structureData?: string; cid?: number }> = [];
  for (const row of input.data.rows) {
    const wanted = normalize(row.compoundName);
    const candidates = libraryRows.filter(item => {
      const name = normalize(item.Compound_Name);
      return name === wanted || (wanted.length >= 4 && name.includes(wanted)) || (name.length >= 4 && wanted.includes(name));
    }).sort((a, b) => {
      const nameA = normalize(a.Compound_Name); const nameB = normalize(b.Compound_Name);
      return Number(nameA !== wanted) - Number(nameB !== wanted) || nameA.length - nameB.length;
    });
    const match = candidates[0];
    const inchi = String(match?.INCHI ?? '').replace(/^"|"$/g, '').trim();
    const smiles = String(match?.Smiles ?? '').trim();
    const valid = (value: string) => value && !['null', 'nan', 'n/a'].includes(value.toLowerCase());
    const validInchi = valid(inchi); const validSmiles = valid(smiles);
    if (!match || (!validInchi && !validSmiles)) { resolved.push({ id: row.id, status: 'not_found' }); continue; }
    try {
      const imageController = new AbortController(); const imageTimer = setTimeout(() => imageController.abort(), 10_000);
      const query = validInchi ? `inchi=${encodeURIComponent(inchi)}` : `smiles=${encodeURIComponent(smiles)}`;
      const imageResponse = await fetch(`https://structure.gnps2.org/structureimg?${query}`, { signal: imageController.signal }); clearTimeout(imageTimer);
      if (!imageResponse.ok) { resolved.push({ id: row.id, status: 'not_found' }); continue; }
      const contentType = imageResponse.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) { resolved.push({ id: row.id, status: 'not_found' }); continue; }
      const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
      resolved.push({ id: row.id, status: 'found', structureData: `data:${contentType.split(';')[0]};base64,${base64}` });
    } catch { resolved.push({ id: row.id, status: 'error' }); }
  }
  response.json({ resolved, task, libraryMatches: libraryRows.length, found: resolved.filter(item => item.status === 'found').length });
});

app.post('/api/export/xlsx', async (request, response, next) => {
  try {
    const body = exportSchema.parse(request.body);
    const rows = reportRows(body.rows);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.columns = [
      ['STT', 'stt', 8], ['RT', 'rt', 12], ['Tên hoạt chất', 'ten_hoat_chat', 32], ['Ion', 'ion', 16],
      ['m/z precursor', 'mz_precursor', 18], ['m/z fragments', 'mz_fragments', 28], ['Công thức', 'cong_thuc', 18], ['Sai số ppm', 'sai_so_ppm', 16],
    ].map(([header, key, width]) => ({ header, key, width })) as ExcelJS.Column[];
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF075985' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = `A1:H${Math.max(1, rows.length + 1)}`;
    const output = await workbook.xlsx.writeBuffer();
    const name = safeName(body.fileName ?? body.title ?? `GNPS2_Data_${new Date().toISOString().slice(0, 10)}`);
    response.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': contentDisposition(`${name}.xlsx`) });
    response.send(Buffer.from(output));
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
  console.error('[GNPS2_API]', error);
  response.status(error instanceof z.ZodError ? 400 : 500).json({ message });
});

const port = Number(process.env.PORT ?? 8787);
if (existsSync(path.join(root, 'dist'))) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
}
app.listen(port, () => console.log(`GNPS2 API listening on http://localhost:${port}`));
