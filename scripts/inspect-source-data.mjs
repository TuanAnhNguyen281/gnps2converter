import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsvPath = path.join(root, 'imports', 'Cao_xa_den_1_neg.source.tsv');
const xlsxPath = path.join(root, 'imports', 'Data.source.xlsx');

const tsv = (await readFile(tsvPath, 'utf8')).replace(/^\uFEFF/, '');
const lines = tsv.split(/\r?\n/).filter(Boolean);
console.log(JSON.stringify({
  tsv: {
    rows: Math.max(0, lines.length - 1),
    headers: lines[0]?.split('\t'),
    samples: lines.slice(1, 6).map((line) => line.split('\t')),
  },
}, null, 2));
const matrix = parse(tsv, { delimiter: '\t', bom: true, relax_column_count: true, skip_empty_lines: true });

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxPath);
for (const sheet of workbook.worksheets) {
  const rows = [];
  for (let i = 1; i <= Math.min(sheet.rowCount, 8); i += 1) {
    rows.push(sheet.getRow(i).values.slice(1).map((value) => value && typeof value === 'object' && 'result' in value ? value.result : value));
  }
  console.log(JSON.stringify({ xlsx: { sheet: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, samples: rows } }, null, 2));
  const features = [];
  sheet.eachRow((row, index) => { if (index > 1) features.push({ mz:Number(row.getCell(2).value), rt:Number(row.getCell(3).value) }); });
  const namedRows = [];
  sheet.eachRow((row, index) => { if (index > 1 && String(row.getCell(6).text).trim()) namedRows.push({ row:index, rt_min:row.getCell(4).value, library_compound_name:row.getCell(6).text }); });
  console.log(JSON.stringify({ excelCompoundNames:{ populated:namedRows.length, samples:namedRows.slice(0,20) } }, null, 2));
  for (const [mzLabel, mzColumn] of [['SpecMZ', 6], ['Precursor_MZ', 13], ['ExactMass', 14]]) for (const [label, rtColumn] of [['RT_Query', 2], ['RT_VN_hidden', 17]]) {
      const diagnostics = matrix.slice(1).filter(row=>row.some(value=>String(value??'').trim())).map((row) => {
        const mz = Number(row[mzColumn]); const rt = Number(String(row[rtColumn]).replace(',', '.'));
        const candidates = features.map(feature => ({ ppm:Math.abs(mz-feature.mz)/feature.mz*1e6, drt:Math.abs(rt-feature.rt), feature }));
        const best = [...candidates].sort((a,b)=>a.ppm-b.ppm)[0];
        return { row, best, hasCombined:candidates.some(item=>item.ppm<=10&&item.drt<=.5) };
      });
      const matches = diagnostics.filter(item => item.hasCombined);
      const nearest = diagnostics.sort((a,b)=>a.best.ppm-b.best.ppm).slice(0,3).map(item=>({compound:item.row[10],ppm:item.best.ppm,drt:item.best.drt,mzData:item.best.feature.mz,rtData:item.best.feature.rt}));
      const ppmOnly = diagnostics.filter(({best}) => best.ppm <= 10);
      console.log(JSON.stringify({ tolerance: '10ppm / 0.5min', mzSource:mzLabel, rtSource: label, matched: matches.length, ppmOnly:ppmOnly.length, compounds: matches.map(item => item.row[10]), nearest }, null, 2));
  }
}
