import { describe, expect, it } from 'vitest';
import { matchRows, parseNumber } from './matching.js';
import type { ColumnMapping } from './types.js';

const mapping: ColumnMapping = {
  compoundName: 'Compound_Name', adduct: 'Adduct', precursorMz: 'Precursor_MZ', formula: 'formula',
  reportedPpm: 'MZErrorPPM', fragments: 'fragments', excelCompoundName: 'library_compound_name', excelRt: 'rt_min',
};

describe('matching engine', () => {
  it('parses Vietnamese and international decimals', () => {
    expect(parseNumber('12,02')).toBe(12.02);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
  });
  it('matches inclusively at tolerance and selects best candidate', () => {
    const output = matchRows(
      [{ Compound_Name: 'Glutamic acid', Precursor_MZ: 190.07, Adduct: '[M-H]-' }],
      [{ library_compound_name: 'Candidate Glutamic acid-C2:0 [M+H]+', rt_min: 2.95 }, { library_compound_name: 'Glutamic acid reference', rt_min: 3.1 }], mapping,
      { mzMode: 'ppm', mzTolerance: 10, rtTolerance: 0.5 },
    );
    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].sourceXlsxRow).toBe(3);
    expect(output.rows[0].candidateCount).toBe(2);
    expect(output.rows[0].rtDisplay).toBe('3.1');
    expect(output.rows[0].sourceMetadata).toMatchObject({ Compound_Name: 'Glutamic acid', Precursor_MZ: 190.07, Adduct: '[M-H]-' });
  });
  it('keeps every TSV row and leaves RT blank when Excel has no matching name', () => {
    const output = matchRows(
      [{ Compound_Name: 'Unknown compound', Precursor_MZ: 123.45, Adduct: '[M-H]-' }],
      [{ library_compound_name: 'Glutamic acid', rt_min: 2.95 }], mapping,
      { mzMode: 'ppm', mzTolerance: 10, rtTolerance: 0.5 },
    );
    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].status).toBe('unmatched');
    expect(output.rows[0].rtDisplay).toBe('');
    expect(output.matched).toBe(0);
    expect(output.unmatched).toBe(1);
    expect(output.rows[0].sourceMetadata).toMatchObject({ Compound_Name: 'Unknown compound', Precursor_MZ: 123.45 });
  });
});
