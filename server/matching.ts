import { randomUUID } from 'node:crypto';
import type { ColumnMapping, MatchRow, MatchSettings, RawRow } from './types.js';

export const aliases = {
  compoundName: ['compound_name', 'compound name', 'name', 'ten_hoat_chat'],
  adduct: ['adduct', 'ion'],
  precursorMz: ['precursor_mz', 'precursor mz', 'precursormz', 'mz_precursor', 'mz'],
  formula: ['molecular_formula', 'molecular formula', 'formula', 'cong_thuc'],
  reportedPpm: ['mzerrorppm', 'mz_error_ppm', 'mass error ppm', 'sai_so_ppm'],
  fragments: ['mz_fragments', 'fragments', 'fragment ions', 'ms2', 'ms/ms'],
  excelCompoundName: ['library_compound_name', 'compound_name', 'compound name', 'name'],
  excelRt: ['rt_min', 'rt min', 'rt', 'retention time', 'retention_time'],
} as const;

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[-]+/g, '_');

export function guessColumn(headers: string[], group: keyof typeof aliases): string {
  for (const alias of aliases[group]) {
    const exact = headers.find((header) => normalizeHeader(header) === alias);
    if (exact) return exact;
  }
  return '';
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let input = value.trim().replace(/\s/g, '');
  if (!input) return null;
  if (input.includes(',') && input.includes('.')) {
    input = input.lastIndexOf(',') > input.lastIndexOf('.')
      ? input.replace(/\./g, '').replace(',', '.')
      : input.replace(/,/g, '');
  } else if (input.includes(',')) input = input.replace(',', '.');
  const result = Number(input);
  return Number.isFinite(result) ? result : null;
}

function text(row: RawRow, key: string): string {
  const value = row[key];
  return value == null ? '' : String(value).trim();
}

function sourceMetadata(row: RawRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null]));
}

export function matchRows(
  tsvRows: RawRow[],
  dataRows: RawRow[],
  mapping: ColumnMapping,
  settings: MatchSettings,
): { rows: MatchRow[]; matched: number; invalidTsv: number; invalidData: number; unmatched: number } {
  const normalizeName = (value: unknown) => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[_/\\()[\]{}+,:;"']/g, ' ').replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const features = dataRows.map((row, index) => ({
    row: index + 2,
    name: text(row, mapping.excelCompoundName),
    normalizedName: normalizeName(row[mapping.excelCompoundName]),
    rt: parseNumber(row[mapping.excelRt]),
  })).filter((item) => item.normalizedName && item.rt !== null) as Array<{ row: number; name: string; normalizedName: string; rt: number }>;

  let invalidTsv = 0;
  let unmatched = 0;
  const result: MatchRow[] = [];

  tsvRows.forEach((source, index) => {
    const compoundName = text(source, mapping.compoundName);
    const normalizedCompound = normalizeName(compoundName);
    const mz = parseNumber(source[mapping.precursorMz]);
    if (!normalizedCompound || mz === null) { invalidTsv += 1; return; }
    const candidates = features.filter((feature) =>
      feature.normalizedName === normalizedCompound ||
      (normalizedCompound.length >= 4 && feature.normalizedName.includes(normalizedCompound)) ||
      (feature.normalizedName.length >= 4 && normalizedCompound.includes(feature.normalizedName)),
    ).sort((a, b) => {
      const exactA = a.normalizedName === normalizedCompound ? 0 : 1;
      const exactB = b.normalizedName === normalizedCompound ? 0 : 1;
      return exactA - exactB || a.normalizedName.length - b.normalizedName.length || a.row - b.row;
    });

    const best = candidates[0];
    if (!best) unmatched += 1;
    result.push({
      id: randomUUID(), selected: true, sourceTsvRow: index + 2, sourceXlsxRow: best?.row ?? 0,
      compoundName, adduct: text(source, mapping.adduct),
      mzTsv: mz, mzData: mz, rtTsv: best?.rt ?? 0, rtData: best?.rt ?? 0,
      rtDisplay: best ? String(best.rt) : '',
      deltaDa: 0, deltaPpm: 0, deltaRt: 0,
      candidateCount: candidates.length, molecularFormula: text(source, mapping.formula),
      fragments: text(source, mapping.fragments), reportedMzErrorPpm: parseNumber(source[mapping.reportedPpm]),
      sourceMetadata: sourceMetadata(source),
      status: !best ? 'unmatched' : candidates.length > 1 ? 'ambiguous' : 'matched',
    });
  });

  return { rows: result, matched: result.length - unmatched, invalidTsv, invalidData: dataRows.length - features.length, unmatched };
}
