import type { MatchRow } from "./types";

export type GridPoint = { row: number; column: number };
export type GridSelection = { anchor: GridPoint; focus: GridPoint; cells?: GridPoint[] };
export type GridRange = {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
};

export function orderPinnedColumns(
  columns: string[],
  pinnedColumns: string[],
  leadingColumns: string[],
): string[] {
  const available = new Set(columns);
  const leading = leadingColumns.filter((column) => available.has(column));
  const leadingSet = new Set(leading);
  const pinned = columns.filter((column) => pinnedColumns.includes(column) && !leadingSet.has(column));
  const pinnedSet = new Set([...leading, ...pinned]);
  return [...leading, ...pinned, ...columns.filter((column) => !pinnedSet.has(column))];
}

export function orderPinnedRows<T extends { id: string }>(rows: T[], pinnedRowIds: string[]): T[] {
  const pinned = new Set(pinnedRowIds);
  return [...rows.filter((row) => pinned.has(row.id)), ...rows.filter((row) => !pinned.has(row.id))];
}

export function selectionRowAndColumnIndexes(
  selection: GridSelection | null,
  rowCount: number,
  columnCount: number,
): { rows: number[]; columns: number[] } {
  if (!selection || rowCount <= 0 || columnCount <= 0) return { rows: [], columns: [] };
  if (selection.cells) {
    return {
      rows: [...new Set(selection.cells.map(({ row }) => row).filter((row) => row >= 0 && row < rowCount))].sort((a, b) => a - b),
      columns: [...new Set(selection.cells.map(({ column }) => column).filter((column) => column >= 0 && column < columnCount))].sort((a, b) => a - b),
    };
  }
  const range = gridSelectionRange(selection, rowCount, columnCount);
  if (!range) return { rows: [], columns: [] };
  return {
    rows: Array.from({ length: range.lastRow - range.firstRow + 1 }, (_, index) => range.firstRow + index),
    columns: Array.from({ length: range.lastColumn - range.firstColumn + 1 }, (_, index) => range.firstColumn + index),
  };
}

export function gridSelectionRange(
  selection: GridSelection | null,
  rowCount: number,
  columnCount: number,
): GridRange | null {
  if (!selection || rowCount <= 0 || columnCount <= 0) return null;
  if (selection.cells) {
    if (!selection.cells.length) return null;
    let firstRow = rowCount - 1;
    let lastRow = 0;
    let firstColumn = columnCount - 1;
    let lastColumn = 0;
    for (const cell of selection.cells) {
      firstRow = Math.min(firstRow, cell.row);
      lastRow = Math.max(lastRow, cell.row);
      firstColumn = Math.min(firstColumn, cell.column);
      lastColumn = Math.max(lastColumn, cell.column);
    }
    return {
      firstRow: Math.max(0, Math.min(rowCount - 1, firstRow)),
      lastRow: Math.max(0, Math.min(rowCount - 1, lastRow)),
      firstColumn: Math.max(0, Math.min(columnCount - 1, firstColumn)),
      lastColumn: Math.max(0, Math.min(columnCount - 1, lastColumn)),
    };
  }
  return {
    firstRow: Math.max(0, Math.min(rowCount - 1, Math.min(selection.anchor.row, selection.focus.row))),
    lastRow: Math.max(0, Math.min(rowCount - 1, Math.max(selection.anchor.row, selection.focus.row))),
    firstColumn: Math.max(0, Math.min(columnCount - 1, Math.min(selection.anchor.column, selection.focus.column))),
    lastColumn: Math.max(0, Math.min(columnCount - 1, Math.max(selection.anchor.column, selection.focus.column))),
  };
}

export function isGridCellSelected(
  selection: GridSelection | null,
  row: number,
  column: number,
): boolean {
  if (!selection) return false;
  if (selection.cells) return selection.cells.some((cell) => cell.row === row && cell.column === column);
  const firstRow = Math.min(selection.anchor.row, selection.focus.row);
  const lastRow = Math.max(selection.anchor.row, selection.focus.row);
  const firstColumn = Math.min(selection.anchor.column, selection.focus.column);
  const lastColumn = Math.max(selection.anchor.column, selection.focus.column);
  return row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn;
}

export function isGridRowSelected(selection: GridSelection | null, row: number): boolean {
  if (selection?.cells) return selection.cells.some((cell) => cell.row === row);
  return !!selection && row >= Math.min(selection.anchor.row, selection.focus.row) &&
    row <= Math.max(selection.anchor.row, selection.focus.row);
}

export function makeGridColumnSelection(rowCount: number, column: number): GridSelection | null {
  if (rowCount <= 0) return null;
  return { anchor: { row: 0, column }, focus: { row: rowCount - 1, column } };
}

export function makeGridRowSelection(row: number, columnCount: number): GridSelection {
  const lastColumn = Math.max(0, columnCount - 1);
  return { anchor: { row, column: 0 }, focus: { row, column: lastColumn } };
}

export function toggleGridCellSelection(
  selection: GridSelection | null,
  row: number,
  column: number,
): GridSelection | null {
  const cells = selection?.cells
    ? [...selection.cells]
    : selection
      ? (() => {
          const range = gridSelectionRange(selection, Math.max(selection.anchor.row, selection.focus.row) + 1, Math.max(selection.anchor.column, selection.focus.column) + 1);
          if (!range) return [];
          const rectangle: GridPoint[] = [];
          for (let selectedRow = range.firstRow; selectedRow <= range.lastRow; selectedRow++) {
            for (let selectedColumn = range.firstColumn; selectedColumn <= range.lastColumn; selectedColumn++) {
              rectangle.push({ row: selectedRow, column: selectedColumn });
            }
          }
          return rectangle;
        })()
      : [];
  const existingIndex = cells.findIndex((cell) => cell.row === row && cell.column === column);
  if (existingIndex >= 0) cells.splice(existingIndex, 1);
  else cells.push({ row, column });
  if (!cells.length) return null;
  const point = { row, column };
  return { anchor: point, focus: point, cells };
}

export function moveGridSelection(
  selection: GridSelection,
  rowDelta: number,
  columnDelta: number,
  rowCount: number,
  columnCount: number,
  extend: boolean,
): GridSelection {
  const focus = {
    row: Math.max(0, Math.min(rowCount - 1, selection.focus.row + rowDelta)),
    column: Math.max(0, Math.min(columnCount - 1, selection.focus.column + columnDelta)),
  };
  return { anchor: extend ? selection.anchor : focus, focus };
}

function gridCellValue(row: MatchRow, rowIndex: number, column: number, metadataColumns: string[]) {
  switch (column) {
    case 0: return String(rowIndex + 1);
    case 1: return row.rtDisplay;
    case 2: return row.compoundName;
    case 3: return row.adduct;
    case 4: return String(row.mzTsv ?? "");
    case 5: return row.fragments;
    case 6: return row.molecularFormula;
    case 7: return row.reportedMzErrorPpm == null ? "" : String(row.reportedMzErrorPpm);
    case 8: return row.structureUrl ?? "";
    default: {
      const value = row.sourceMetadata?.[metadataColumns[column - 9]];
      return value == null ? "" : String(value);
    }
  }
}

function gridCellValueForKey(row: MatchRow, rowIndex: number, columnKey: string) {
  switch (columnKey) {
    case "stt": return String(rowIndex + 1);
    case "rtDisplay": return row.rtDisplay;
    case "compoundName": return row.compoundName;
    case "adduct": return row.adduct;
    case "mzTsv": return String(row.mzTsv ?? "");
    case "fragments": return row.fragments;
    case "molecularFormula": return row.molecularFormula;
    case "reportedMzErrorPpm": return row.reportedMzErrorPpm == null ? "" : String(row.reportedMzErrorPpm);
    case "structure": return row.structureUrl ?? "";
    default: {
      const metadataKey = columnKey.startsWith("metadata:") ? columnKey.slice(9) : columnKey;
      const value = row.sourceMetadata?.[metadataKey];
      return value == null ? "" : String(value);
    }
  }
}

function escapeTsvCell(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function selectionToTsv(
  rows: MatchRow[],
  selection: GridSelection | null,
  metadataColumns: string[],
  columns: number | string[],
): { text: string; rowCount: number; columnCount: number } | null {
  const columnKeys = Array.isArray(columns) ? columns : null;
  const columnCount = columnKeys?.length ?? columns as number;
  const range = gridSelectionRange(selection, rows.length, columnCount);
  if (!range) return null;
  const selectedCells = selection?.cells;
  const selectedCellIndexes = selectedCells
    ? new Set(selectedCells.map((cell) => cell.row * columnCount + cell.column))
    : null;
  const text = rows
    .slice(range.firstRow, range.lastRow + 1)
    .map((row, offset) => Array.from(
      { length: range.lastColumn - range.firstColumn + 1 },
      (_, index) => {
        const rowIndex = range.firstRow + offset;
        const column = range.firstColumn + index;
        if (selectedCellIndexes && !selectedCellIndexes.has(rowIndex * columnCount + column)) return "";
        return escapeTsvCell(columnKeys
          ? gridCellValueForKey(row, rowIndex, columnKeys[column])
          : gridCellValue(row, rowIndex, column, metadataColumns));
      },
    ).join("\t"))
    .join("\r\n");
  return {
    text,
    rowCount: range.lastRow - range.firstRow + 1,
    columnCount: range.lastColumn - range.firstColumn + 1,
  };
}
