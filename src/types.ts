export interface MatchRow {
  id: string; selected: boolean; sourceTsvRow: number; sourceXlsxRow: number;
  compoundName: string; adduct: string; mzTsv: number; mzData: number; rtTsv: number; rtData: number; rtDisplay: string;
  deltaDa: number; deltaPpm: number; deltaRt: number; candidateCount: number;
  molecularFormula: string; fragments: string; reportedMzErrorPpm: number | null;
  status: 'matched' | 'ambiguous' | 'unmatched'; structureUrl?: string; structureData?: string;
}

export interface ColumnMapping {
  compoundName: string; adduct: string; precursorMz: string; formula: string; reportedPpm: string;
  fragments: string; excelCompoundName: string; excelRt: string;
}

export interface AnalysisResult {
  source?: 'files' | 'gnps-task'; task?: string; title?: string;
  rows: MatchRow[]; mapping: ColumnMapping; tsvHeaders: string[]; excelHeaders: string[]; sheets: string[];
  summary: { tsvRows: number; dataRows: number; matched: number; unmatched: number; invalidTsv: number; invalidData: number; rtFallback?: number; structures?: number; fragments?: number };
  parameters: { mzMode: 'ppm' | 'da'; mzTolerance: number; rtTolerance: number };
}

export type PreviewValue = string | number | null;
export interface FilePreview {
  fileName: string; fileType: 'tsv' | 'xlsx'; sheets: string[]; activeSheet: string;
  columns: string[]; rows: PreviewValue[][]; totalRows: number; previewLimited: boolean;
}
