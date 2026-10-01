import { describe, expect, it } from "vitest";
import type { MatchRow } from "./types";
import {
  gridSelectionRange,
  isGridCellSelected,
  makeGridColumnSelection,
  makeGridRowSelection,
  moveGridSelection,
  orderPinnedColumns,
  orderPinnedRows,
  selectionToTsv,
  selectionRowAndColumnIndexes,
  toggleGridCellSelection,
} from "./result-table-grid";

function row(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: "row-1",
    selected: true,
    sourceTsvRow: 2,
    sourceXlsxRow: 2,
    compoundName: "Caffeine",
    adduct: "[M+H]+",
    mzTsv: 195.087,
    mzData: 195.087,
    rtTsv: 1.2,
    rtData: 1.2,
    rtDisplay: "1.2",
    deltaDa: 0,
    deltaPpm: 0,
    deltaRt: 0,
    candidateCount: 1,
    molecularFormula: "C8H10N4O2",
    fragments: "138.066;110.071",
    reportedMzErrorPpm: null,
    sourceMetadata: {},
    status: "matched",
    ...overrides,
  };
}

describe("result table grid selection and clipboard format", () => {
  it("selects a whole visible row or column and moves/extends cells", () => {
    expect(makeGridRowSelection(1, 12)).toEqual({
      anchor: { row: 1, column: 0 },
      focus: { row: 1, column: 11 },
    });
    expect(makeGridColumnSelection(3, 4)).toEqual({
      anchor: { row: 0, column: 4 },
      focus: { row: 2, column: 4 },
    });
    const start = { anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } };
    expect(moveGridSelection(start, 1, 1, 3, 4, true)).toEqual({
      anchor: { row: 0, column: 1 },
      focus: { row: 1, column: 2 },
    });
    expect(isGridCellSelected({ anchor: { row: 1, column: 2 }, focus: { row: 0, column: 1 } }, 1, 1)).toBe(true);
    expect(gridSelectionRange(null, 3, 4)).toBeNull();
  });

  it("copies reversed ranges as quoted TSV in current row order", () => {
    const rows = [
      row({ compoundName: "Caffeine\tstandard" }),
      row({ id: "row-2", compoundName: "Aspirin", adduct: "[M-H]-" }),
    ];
    const copied = selectionToTsv(
      rows,
      { anchor: { row: 1, column: 3 }, focus: { row: 0, column: 2 } },
      [],
      9,
    );
    expect(copied).toEqual({
      text: '"Caffeine\tstandard"\t[M+H]+\r\nAspirin\t[M-H]-',
      rowCount: 2,
      columnCount: 2,
    });
  });

  it("copies source metadata as blank cells when values are missing", () => {
    const rows = [
      row({ sourceMetadata: { SpectrumID: "spec-1" } }),
      row({ id: "row-2", sourceMetadata: { SpectrumID: null } }),
    ];
    expect(selectionToTsv(
      rows,
      makeGridColumnSelection(2, 9),
      ["SpectrumID"],
      10,
    )).toEqual({ text: "spec-1\r\n", rowCount: 2, columnCount: 1 });
  });

  it("adds and removes disjoint cells with modifier selection", () => {
    const one = toggleGridCellSelection(null, 0, 1);
    const two = toggleGridCellSelection(one, 1, 2);
    expect(two?.cells).toEqual([{ row: 0, column: 1 }, { row: 1, column: 2 }]);
    expect(toggleGridCellSelection(two, 0, 1)?.cells).toEqual([{ row: 1, column: 2 }]);
    expect(toggleGridCellSelection(toggleGridCellSelection(null, 0, 0), 0, 0)).toBeNull();
  });

  it("keeps empty TSV placeholders between non-adjacent selected cells", () => {
    const rows = [row(), row({ id: "row-2", compoundName: "Aspirin" })];
    const selection = toggleGridCellSelection(toggleGridCellSelection(null, 0, 1), 1, 2);
    expect(selectionToTsv(rows, selection, [], 9)).toEqual({
      text: "1.2\t\r\n\tAspirin",
      rowCount: 2,
      columnCount: 2,
    });
  });

  it("moves pinned columns after the identity columns and pinned rows to the top", () => {
    expect(orderPinnedColumns(
      ["stt", "rtDisplay", "compoundName", "adduct", "metadata:ID"],
      ["adduct", "metadata:ID"],
      ["stt", "compoundName"],
    )).toEqual(["stt", "compoundName", "adduct", "metadata:ID", "rtDisplay"]);
    const rows = [row(), row({ id: "row-2" }), row({ id: "row-3" })];
    expect(orderPinnedRows(rows, ["row-3", "row-1"]).map(({ id }) => id)).toEqual([
      "row-1", "row-3", "row-2",
    ]);
  });

  it("derives only the represented rows and columns from disjoint selections", () => {
    const selection = toggleGridCellSelection(toggleGridCellSelection(null, 0, 3), 2, 1);
    expect(selectionRowAndColumnIndexes(selection, 3, 4)).toEqual({
      rows: [0, 2],
      columns: [1, 3],
    });
    expect(selectionRowAndColumnIndexes({
      anchor: { row: 2, column: 2 },
      focus: { row: 0, column: 1 },
    }, 3, 4)).toEqual({ rows: [0, 1, 2], columns: [1, 2] });
  });

  it("copies using the reordered visible columns", () => {
    const rows = [row({ compoundName: "Caffeine", adduct: "[M+H]+" })];
    expect(selectionToTsv(
      rows,
      { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 2 } },
      [],
      ["stt", "compoundName", "adduct"],
    )).toEqual({ text: "1\tCaffeine\t[M+H]+", rowCount: 1, columnCount: 3 });
  });

  it("copies the entire compound-name column in visible row order", () => {
    const rows = orderPinnedRows([
      row({ id: "row-1", compoundName: "Malic acid" }),
      row({ id: "row-2", compoundName: "Azelaic acid" }),
    ], ["row-2"]);
    const columns = orderPinnedColumns(
      ["stt", "rtDisplay", "compoundName", "adduct"],
      [],
      ["stt", "compoundName"],
    );
    expect(selectionToTsv(
      rows,
      makeGridColumnSelection(rows.length, columns.indexOf("compoundName")),
      [],
      columns,
    )).toEqual({ text: "Azelaic acid\r\nMalic acid", rowCount: 2, columnCount: 1 });
  });
});
