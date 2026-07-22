import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Data');
sheet.columns = [
  { header: 'mz', key: 'mz', width: 16 },
  { header: 'rt', key: 'rt', width: 12 },
  { header: 'intensity', key: 'intensity', width: 16 },
  { header: 'library_compound_name', key: 'library_compound_name', width: 30 },
];
sheet.addRows([
  { mz: 179.0342, rt: 12.1, intensity: 98540, library_compound_name: 'Caffeic acid' },
  { mz: 301.0351, rt: 8.42, intensity: 78220, library_compound_name: 'Quercetin' },
  { mz: 609.1455, rt: 6.32, intensity: 45310, library_compound_name: 'Rutin' },
  { mz: 150.0123, rt: 2.1, intensity: 19220 },
]);
sheet.getRow(1).font = { bold: true };
await workbook.xlsx.writeFile(path.join(root, 'samples', 'Data.demo.xlsx'));
console.log('Created samples/Data.demo.xlsx');
