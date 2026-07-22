import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { previewTsv, previewXlsx } from './file-preview.js';

describe('file preview', () => {
  it('parses TSV and makes empty or duplicate headers unique', () => {
    const result = previewTsv(Buffer.from('Name\tName\t\nA\tB\t0\n'), 'sample.tsv');
    expect(result.columns).toEqual(['Name', 'Name (2)', 'Cột 3']);
    expect(result.rows).toEqual([['A', 'B', '0']]);
    expect(result.totalRows).toBe(1);
  });

  it('selects an XLSX sheet and preserves numeric zero', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Một').addRows([['A'], ['x']]);
    workbook.addWorksheet('Hai').addRows([['mz', 'rt'], [0, 12.02]]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await previewXlsx(buffer, 'data.xlsx', 'Hai');
    expect(result.activeSheet).toBe('Hai');
    expect(result.sheets).toEqual(['Một', 'Hai']);
    expect(result.rows).toEqual([[0, 12.02]]);
  });
});
