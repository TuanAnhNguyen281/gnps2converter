export type MzMode = 'ppm' | 'da';

export interface RawRow { [key: string]: string | number | null | undefined }

export interface ColumnMapping {
  compoundName: string;
  adduct: string;
  precursorMz: string;
  formula: string;
  reportedPpm: string;
  fragments: string;
  excelCompoundName: string;
  excelRt: string;
}

export interface MatchSettings {
  mzMode: MzMode;
  mzTolerance: number;
  rtTolerance: number;
}

export interface MatchRow {
  id: string;
  selected: boolean;
  sourceTsvRow: number;
  sourceXlsxRow: number;
  compoundName: string;
  adduct: string;
  mzTsv: number;
  mzData: number;
  rtTsv: number;
  rtData: number;
  rtDisplay: string;
  deltaDa: number;
  deltaPpm: number;
  deltaRt: number;
  candidateCount: number;
  molecularFormula: string;
  fragments: string;
  reportedMzErrorPpm: number | null;
  status: 'matched' | 'ambiguous' | 'unmatched';
  structureUrl?: string;
  structureData?: string;
}
