import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  AnalysisResult,
  ColumnMapping,
  FilePreview,
  MatchRow,
  PreviewValue,
} from "./types";
import {
  isGridCellSelected as cellIsSelected,
  isGridRowSelected as rowIsSelected,
  makeGridColumnSelection,
  makeGridRowSelection,
  moveGridSelection,
  orderPinnedColumns,
  orderPinnedRows,
  selectionRowAndColumnIndexes,
  selectionToTsv,
  toggleGridCellSelection,
  type GridSelection,
} from "./result-table-grid";

import { apiFetch, apiUrl, jsonApi, postProgressStream, type PipelineProgress } from "./api";
import { useReport, type SavedResult } from "./useReport";
import { useAccount } from "./Account";
import './ai/ai.css';
import {
  WorkspaceShell,
  ReportLibrary,
  AccountPage,
  AssetsPanel,
  type WorkspacePage,
  type StoredAsset,
} from "./Workspace";
import { Icon, EmptyState, useConfirm, useEditorDialogs, tabKeys } from "./Ui";

const icons = {
  flask: (
    <svg viewBox="0 0 24 24">
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24">
      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24">
      <path d="M6 2h8l4 4v16H6zM14 2v5h5M9 13h6m-6 4h6" />
    </svg>
  ),
  tune: (
    <svg viewBox="0 0 24 24">
      <path d="M4 7h10m4 0h2M14 4v6M4 17h2m4 0h10M10 14v6" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24">
      <path d="m5 12 4 4L19 6" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24">
      <path d="M4 6h16l-6.5 7.2V19l-3 1v-6.8z" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24">
      <path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ),
  external: (
    <svg viewBox="0 0 24 24">
      <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24">
      <path d="M20 7v5h-5M4 17v-5h5M6.1 8a7 7 0 0 1 11.5-1.6L20 9M4 15l2.4 2.6A7 7 0 0 0 17.9 16" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24">
      <path d="m16 3 5 5-4 1-4 4-1 5-2-2-5 5 2-7 5-5 4-4z" />
      <path d="m8 16-5 5" />
    </svg>
  ),
};

type Stage = "upload" | "results";
type PreviewKind = "tsv" | "xlsx";
type PreviewStatus = {
  data: FilePreview | null;
  loading: boolean;
  error: string;
};
type SortKind = "number" | "text";
type SortDirection = "asc" | "desc";
type SortState = {
  column: string;
  direction: SortDirection;
  kind: SortKind;
} | null;
type ColumnResizeSession = { key: string; startX: number; startWidth: number };
const columnWidthStorageKey = "gnps-report-column-widths-v1";
const gridPinStorageKey = "gnps-report-grid-pins-v1";
type ReportGridPins = { rowIds: string[]; columnKeys: string[] };
const defaultColumnWidths: Record<string, number> = {
  stt: 38,
  rtDisplay: 78,
  compoundName: 150,
  adduct: 84,
  mzTsv: 82,
  fragments: 110,
  molecularFormula: 94,
  reportedMzErrorPpm: 72,
  structure: 76,
};
const minColumnWidth = 44;
const maxColumnWidth = 600;
const formatSavedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
};
const mappingLabels: Record<keyof ColumnMapping, string> = {
  compoundName: "Tên hoạt chất (TSV) *",
  adduct: "Ion/Adduct (TSV)",
  precursorMz: "Precursor m/z (TSV) *",
  formula: "Công thức phân tử (TSV)",
  reportedPpm: "Sai số MZErrorPPM (TSV)",
  fragments: "Mảnh vỡ (TSV)",
  excelCompoundName: "Tên đối chiếu (Excel) *",
  excelRt: "tR (min) từ Excel *",
};

const preferredMetadataColumns = [
  "SpectrumID",
  "#Scan#",
  "SpectrumFile",
  "LibraryName",
  "MQScore",
  "TIC_Query",
  "RT_Query",
  "MZErrorPPM",
  "SharedPeaks",
  "MassDiff",
  "SpecMZ",
  "SpecCharge",
  "FileScanUniqueID",
  "NumberHits",
  "Compound_Name",
  "Ion_Source",
  "Instrument",
  "Compound_Source",
  "PI",
  "Data_Collector",
  "Adduct",
  "Precursor_MZ",
  "ExactMass",
  "Charge",
  "CAS_Number",
  "Pubmed_ID",
  "Smiles",
  "INCHI",
  "INCHI_AUX",
  "Library_Class",
  "IonMode",
  "Organism",
  "LibMZ",
  "UpdateWorkflowName",
  "LibraryQualityString",
  "tags",
  "molecular_formula",
  "InChIKey",
  "InChIKey-Planar",
  "superclass",
  "class",
  "subclass",
  "npclassifier_superclass",
  "npclassifier_class",
  "npclassifier_pathway",
  "library_usi",
] as const;

const metadataHeaderLabels: Record<string, string> = {
  SpectrumID: "Mã phổ",
  "#Scan#": "Số scan",
  SpectrumFile: "Tệp phổ",
  LibraryName: "Tên thư viện",
  MQScore: "Điểm MQ",
  TIC_Query: "TIC truy vấn",
  RT_Query: "RT truy vấn",
  MZErrorPPM: "Sai số MZ (ppm)",
  SharedPeaks: "Đỉnh chung",
  MassDiff: "Chênh lệch khối lượng",
  SpecMZ: "MZ phổ",
  SpecCharge: "Điện tích phổ",
  FileScanUniqueID: "ID scan duy nhất",
  NumberHits: "Số kết quả",
  Compound_Name: "Tên hợp chất",
  Ion_Source: "Nguồn ion",
  Instrument: "Thiết bị",
  Compound_Source: "Nguồn hợp chất",
  PI: "PI",
  Data_Collector: "Người thu thập",
  Adduct: "Ion cộng",
  Precursor_MZ: "MZ tiền chất",
  ExactMass: "Khối lượng chính xác",
  Charge: "Điện tích",
  CAS_Number: "Số CAS",
  Pubmed_ID: "Mã PubMed",
  Smiles: "Cấu trúc SMILES",
  INCHI: "Cấu trúc InChI",
  INCHI_AUX: "InChI phụ",
  Library_Class: "Cấp thư viện",
  IonMode: "Chế độ ion",
  Organism: "Sinh vật",
  LibMZ: "MZ thư viện",
  UpdateWorkflowName: "Quy trình cập nhật",
  LibraryQualityString: "Chất lượng thư viện",
  tags: "Nhãn",
  molecular_formula: "Công thức phân tử",
  InChIKey: "Khóa InChI",
  "InChIKey-Planar": "Khóa InChI phẳng",
  superclass: "Siêu lớp",
  class: "Lớp",
  subclass: "Phân lớp",
  npclassifier_superclass: "Siêu lớp NPClassifier",
  npclassifier_class: "Lớp NPClassifier",
  npclassifier_pathway: "Con đường NPClassifier",
  library_usi: "USI thư viện",
};

function metadataHeaderLabel(column: string) {
  return (
    metadataHeaderLabels[column] ??
    column.replaceAll("_", " ").replaceAll("-", " ")
  );
}

function metadataText(value: string | number | null | undefined) {
  return value == null || value === "" ? "—" : String(value);
}

const vietnameseCollator = new Intl.Collator("vi", {
  numeric: true,
  sensitivity: "base",
});

function sortableNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferSortKind(values: unknown[]): SortKind {
  const populated = values.filter(
    (value) => value != null && String(value).trim() !== "",
  );
  return populated.length > 0 &&
    populated.every((value) => sortableNumber(value) != null)
    ? "number"
    : "text";
}

function SortableHeader({
  column,
  label,
  subtitle,
  kind,
  sort,
  menuOpen,
  onMenu,
  onSort,
}: {
  column: string;
  label: string;
  subtitle: string;
  kind: SortKind;
  sort: SortState;
  menuOpen: boolean;
  onMenu: (column: string | null) => void;
  onSort: (sort: SortState) => void;
}) {
  const active = sort?.column === column;
  return (
    <>
      <small className="table-heading-en">{subtitle}</small>
      <span className="table-heading-vn">{label}</span>
      <button
        type="button"
        className={`column-filter-trigger ${active ? "active" : ""}`}
        aria-label={`Sắp xếp cột ${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Sắp xếp ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onMenu(menuOpen ? null : column);
        }}
      >
        {icons.filter}
        <span>{active ? (sort?.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
      {menuOpen && (
        <div
          className="column-filter-menu"
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={active && sort?.direction === "asc" ? "active" : ""}
            onClick={() => {
              onSort({ column, direction: "asc", kind });
              onMenu(null);
            }}
          >
            <b>↑</b>
            <span>{kind === "number" ? "Từ thấp đến cao" : "A → Z"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={active && sort?.direction === "desc" ? "active" : ""}
            onClick={() => {
              onSort({ column, direction: "desc", kind });
              onMenu(null);
            }}
          >
            <b>↓</b>
            <span>{kind === "number" ? "Từ cao đến thấp" : "Z → A"}</span>
          </button>
          {active && (
            <button
              type="button"
              role="menuitem"
              className="clear-sort"
              onClick={() => {
                onSort(null);
                onMenu(null);
              }}
            >
              <b>×</b>
              <span>Xóa sắp xếp</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

function gnpsCompareUrl(result: AnalysisResult, rawUrl: string) {
  if (result.task && /^[a-f0-9]{32}$/i.test(result.task)) {
    return `https://gnps2.org/result?task=${result.task}&viewname=librarymatches`;
  }
  try {
    const url = new URL(rawUrl.trim());
    if (
      url.protocol !== "https:" ||
      !["gnps2.org", "www.gnps2.org"].includes(url.hostname.toLowerCase())
    )
      return "";
    const task = url.searchParams.get("task");
    if (url.pathname.includes("/status") && task)
      return `https://gnps2.org/result?task=${encodeURIComponent(task)}&viewname=librarymatches`;
    return url.toString();
  } catch {
    return "";
  }
}

function MetadataCell({
  value,
  selected,
  editing,
  numeric,
  onChange,
  onPointerDown,
  onPointerEnter,
  onEditorPointerDown,
  className = "",
  style,
}: {
  value: string | number | null | undefined;
  selected: boolean;
  editing: boolean;
  numeric: boolean;
  onChange: (value: string | number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLTableCellElement>) => void;
  onPointerEnter: (event: ReactPointerEvent<HTMLTableCellElement>) => void;
  onEditorPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const text = metadataText(value);
  return (
    <td
      className={`metadata-cell grid-cell ${className} ${selected ? "grid-cell-selected" : ""}`}
      style={style}
      title={text}
      data-copy-value={text === "—" ? "" : text}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
    >
      {editing ? (
        <GridEditInput
          className="grid-edit-input"
          type={numeric ? "number" : "text"}
          step="any"
          aria-label={`Chỉnh sửa ${text}`}
          onPointerDown={onEditorPointerDown}
          value={value}
          onChange={(next) => onChange(numeric ? next : (next ? String(next) : null))}
        />
      ) : (
        <span className="readonly-cell-content">{text}</span>
      )}
      {!editing && text !== "—" && (
        <button
          type="button"
          aria-label={`Sao chép ${text}`}
          title="Sao chép"
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard?.writeText(text);
          }}
        >
          {icons.copy}
        </button>
      )}
    </td>
  );
}

function GridEditInput({
  value,
  type = "text",
  className,
  step,
  ...props
}: {
  value: string | number | null | undefined;
  type?: "text" | "number";
  className: string;
  step?: string;
  "aria-label": string;
  onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onChange: (value: string | number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const commitNumber = () => {
    const parsed = draft.trim() ? Number(draft) : null;
    props.onChange(parsed != null && Number.isFinite(parsed) ? parsed : null);
  };
  return (
    <input
      {...props}
      className={className}
      type={type}
      step={type === "number" ? step ?? "any" : undefined}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (type === "text") props.onChange(next);
      }}
      onBlur={() => {
        if (type === "number") commitNumber();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && type === "number") event.currentTarget.blur();
      }}
    />
  );
}

type EngineStatus = "checking" | "ready" | "offline";

function FileDrop({
  accept,
  label,
  hint,
  file,
  onFile,
}: {
  accept: string;
  label: string;
  hint: string;
  file: File | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <button
      type="button"
      className={`dropzone ${drag ? "drag" : ""} ${file ? "has-file" : ""}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const next = e.dataTransfer.files[0];
        if (next) onFile(next);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <span className="drop-icon">{file ? icons.check : icons.upload}</span>
      <span className="drop-copy">
        <strong>{file ? file.name : label}</strong>
        <small>
          {file ? `${(file.size / 1024).toFixed(1)} KB · Sẵn sàng` : hint}
        </small>
      </span>
      <span className="file-pill">
        {accept.replaceAll(".", "").toUpperCase()}
      </span>
    </button>
  );
}

function titleFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Highlight({ value, query }: { value: PreviewValue; query: string }) {
  const text = value == null ? "" : String(value);
  const needle = query.trim().toLocaleLowerCase("vi");
  if (!needle) return <>{text || "—"}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const lower = text.toLocaleLowerCase("vi");
  while (cursor < text.length) {
    const found = lower.indexOf(needle, cursor);
    if (found < 0) {
      parts.push(text.slice(cursor));
      break;
    }
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(
      <mark key={`${found}-${cursor}`}>
        {text.slice(found, found + needle.length)}
      </mark>,
    );
    cursor = found + needle.length;
  }
  return <>{parts.length ? parts : text || "—"}</>;
}

function FileViewer({
  files,
  previews,
  onSheet,
  initialActive = "tsv",
  onClose,
}: {
  files: Record<PreviewKind, File | null>;
  previews: Record<PreviewKind, PreviewStatus>;
  onSheet: (sheet: string) => void;
  initialActive?: PreviewKind;
  onClose?: () => void;
}) {
  const [active, setActive] = useState<PreviewKind>(initialActive);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const current = previews[active];
  const file = files[active];
  const pageSize = 50;
  useEffect(() => {
    if (!files[active] && files[active === "tsv" ? "xlsx" : "tsv"])
      setActive(active === "tsv" ? "xlsx" : "tsv");
  }, [files.tsv, files.xlsx]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    const rows = current.data?.rows ?? [];
    return needle
      ? rows.filter((row) =>
          row.some((value) =>
            String(value ?? "")
              .toLocaleLowerCase("vi")
              .includes(needle),
          ),
        )
      : rows;
  }, [current.data, search]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  useEffect(() => setPage(1), [active, search, current.data?.activeSheet]);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const shown = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  return (
    <section className="file-viewer" aria-label="Trình xem nội dung file">
      <header className="viewer-head">
        <div>
          <small>TRÌNH XEM FILE</small>
          <strong>{file?.name ?? "Chưa chọn file"}</strong>
          {file && (
            <span>
              {(file.size / 1024).toLocaleString("vi-VN", {
                maximumFractionDigits: 1,
              })}{" "}
              KB
            </span>
          )}
        </div>
        <div className="viewer-head-actions">
          <div className="viewer-tabs">
            <button
              title={files.tsv?.name}
              className={active === "tsv" ? "active" : ""}
              disabled={!files.tsv}
              onClick={() => setActive("tsv")}
            >
              {files.tsv?.name ?? "TSV"}
            </button>
            <button
              title={files.xlsx?.name}
              className={active === "xlsx" ? "active" : ""}
              disabled={!files.xlsx}
              onClick={() => setActive("xlsx")}
            >
              {files.xlsx?.name ?? "XLSX"}
            </button>
          </div>
          {onClose && (
            <button
              className="viewer-close"
              onClick={onClose}
              aria-label="Đóng trình xem"
            >
              {icons.close}
            </button>
          )}
        </div>
      </header>
      <div className="viewer-toolbar">
        <label className="viewer-search">
          {icons.search}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm trong toàn bộ nội dung…"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Xóa tìm kiếm">
              ×
            </button>
          )}
        </label>
        {active === "xlsx" && current.data?.sheets.length ? (
          <select
            value={current.data.activeSheet}
            onChange={(event) => onSheet(event.target.value)}
          >
            {current.data.sheets.map((sheet) => (
              <option key={sheet}>{sheet}</option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="viewer-body">
        {current.loading ? (
          <div className="viewer-state">
            <span className="spinner" />
            <strong>Đang đọc nội dung file…</strong>
          </div>
        ) : current.error ? (
          <div className="viewer-state error">
            <strong>Không thể xem file</strong>
            <span>{current.error}</span>
          </div>
        ) : !file ? (
          <div className="viewer-state">
            {icons.file}
            <strong>Chọn file {active.toUpperCase()} để xem nội dung</strong>
            <span>Dữ liệu sẽ xuất hiện tại đây trước khi đối chiếu.</span>
          </div>
        ) : current.data ? (
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  {current.data.columns.map((column, index) => (
                    <th key={`${column}-${index}`} title={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, rowIndex) => (
                  <tr key={(page - 1) * pageSize + rowIndex}>
                    <td>{(page - 1) * pageSize + rowIndex + 1}</td>
                    {current.data!.columns.map((_, cellIndex) => (
                      <td key={cellIndex} title={String(row[cellIndex] ?? "")}>
                        <Highlight
                          value={row[cellIndex] ?? null}
                          query={search}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <div className="viewer-empty">
                Không tìm thấy nội dung phù hợp.
              </div>
            )}
          </div>
        ) : null}
      </div>
      {current.data && (
        <footer className="viewer-footer">
          <div>
            <b>{filteredRows.length.toLocaleString("vi-VN")}</b>/
            {current.data.totalRows.toLocaleString("vi-VN")} dòng ·{" "}
            {current.data.columns.length} cột
            {current.data.previewLimited && (
              <span> · Chỉ xem trước 1.000 dòng</span>
            )}
          </div>
          <div className="viewer-pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              ←
            </button>
            <span>
              {page}/{pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              →
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

async function download(
  url: string,
  revision: number,
  extension: string,
  title: string,
) {
  const response = await apiFetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision }),
  });
  if (!response.ok)
    throw new Error((await response.json()).message ?? "Không thể xuất file.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const safeTitle =
    title.replace(/[\\/:*?"<>|]/g, "_").trim() || "GNPS2_Report";
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${safeTitle}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return response.headers.get("X-Archive-Status") === "failed";
}

export default function App() {
  const { initialEntry, initialTaskUrl, goHome } = useAccount();
  const [page, setPage] = useState<WorkspacePage>(
    initialEntry === "reports" ? "reports" : "upload",
  );
  const [reportListRevision, setReportListRevision] = useState(0);
  const pendingProject = useRef<{id:string;oldReportId:string|null}|null>(null);
  const [reportTab, setReportTab] = useState<"results" | "assets">("results");
  const ask = useConfirm();
  const [inputMode, setInputMode] = useState<"task" | "files">(
    initialEntry === "files" ? "files" : "task",
  );
  const [taskUrl, setTaskUrl] = useState(initialTaskUrl);
  useEffect(() => {
    if (initialTaskUrl) sessionStorage.removeItem("gnps-task-url");
  }, [initialTaskUrl]);
  const [tsv, setTsv] = useState<File | null>(null);
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [previews, setPreviews] = useState<Record<PreviewKind, PreviewStatus>>({
    tsv: { data: null, loading: false, error: "" },
    xlsx: { data: null, loading: false, error: "" },
  });
  const previewRequests = useRef<Record<PreviewKind, number>>({
    tsv: 0,
    xlsx: 0,
  });
  const [reportTitle, setReportTitle] = useState("");
  const [gnpsUrl, setGnpsUrl] = useState("");
  const [stage, setStage] = useState<Stage>("upload");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const saved = useReport(stage === "results" ? result : null, reportTitle);
  async function attachImportedReport(payload:SavedResult){
    const pending=pendingProject.current;
    if(!pending||!payload.reportId||payload.reportId===pending.oldReportId)return;
    pendingProject.current=null;
    try{await jsonApi(`/api/projects/${pending.id}/reports`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportId:payload.reportId})});setReportListRevision(x=>x+1);}
    catch(e){setError(`Báo cáo đã lưu nhưng chưa gắn project: ${(e as Error).message}. Mở Project & AI chat để thêm báo cáo.`);}
  }
  const saveBadgeState = saved.conflict || saved.status === "conflict"
    ? "conflict"
    : saved.saving
      ? "saving"
      : saved.status === "error" || saved.status === "partial"
        ? saved.status
        : saved.dirty()
          ? "unsaved"
          : saved.status;
  const saveBadgeLabel =
    saveBadgeState === "saving"
      ? saved.saveMethod === "automatic"
        ? "Đang tự lưu…"
        : "Đang lưu…"
      : saveBadgeState === "saved"
        ? saved.saveMethod === "automatic"
          ? "Đã tự lưu"
          : "Đã lưu"
        : saveBadgeState === "partial"
          ? "Dữ liệu đã lưu · ảnh/file cần kiểm tra"
          : saveBadgeState === "error"
            ? "Lưu thất bại"
            : saveBadgeState === "conflict"
              ? "Xung đột lưu"
              : "Có thay đổi chưa lưu";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(null);
  const [pinScopeKey, setPinScopeKey] = useState(() => `draft:${crypto.randomUUID()}`);
  const [gridPinPreferences, setGridPinPreferences] = useState<Record<string, ReportGridPins>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(gridPinStorageKey) || "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(stored).flatMap(([key, value]) => {
        if (!value || typeof value !== "object") return [];
        const pins = value as Partial<ReportGridPins>;
        return [[key, {
          rowIds: Array.isArray(pins.rowIds) ? pins.rowIds.filter((id): id is string => typeof id === "string") : [],
          columnKeys: Array.isArray(pins.columnKeys) ? pins.columnKeys.filter((column): column is string => typeof column === "string") : [],
        } satisfies ReportGridPins]];
      }));
    } catch {
      return {};
    }
  });
  const [copyMessage, setCopyMessage] = useState("");
  const [allEditMode, setAllEditMode] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(columnWidthStorageKey) || "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(stored).filter(([, width]) =>
        typeof width === "number" && Number.isFinite(width) && width >= minColumnWidth && width <= maxColumnWidth,
      )) as Record<string, number>;
    } catch {
      return {};
    }
  });
  const [editingCompoundId, setEditingCompoundId] = useState<string | null>(null);
  const [compoundDraft, setCompoundDraft] = useState("");
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const gridHeadRef = useRef<HTMLTableSectionElement>(null);
  const pinnedGridRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [gridHeaderHeight, setGridHeaderHeight] = useState(42);
  const [pinnedGridRowOffsets, setPinnedGridRowOffsets] = useState<Record<string, number>>({});
  const dragAnchorRef = useRef<{ row: number; column: number } | null>(null);
  const dragSelectionActiveRef = useRef(false);
  const columnResizeRef = useRef<ColumnResizeSession | null>(null);
  const [status, setStatus] = useState<
    "all" | "matched" | "ambiguous" | "unmatched" | "selected"
  >("all");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [headers, setHeaders] = useState<{ tsv: string[]; excel: string[] }>({
    tsv: [],
    excel: [],
  });
  const [exporting, setExporting] = useState("");
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureMessage, setStructureMessage] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"task" | "files" | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<PipelineProgress | null>(null);
  const [detailRow, setDetailRow] = useState<MatchRow | null>(null);
  const [viewerTarget, setViewerTarget] = useState<PreviewKind | null>(null);
  const [gnpsViewerOpen, setGnpsViewerOpen] = useState(false);
  const [gnpsFrameVersion, setGnpsFrameVersion] = useState(0);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("checking");
  useEffect(() => {
    if (!sortMenuOpen) return;
    const closeMenu = () => setSortMenuOpen(null);
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [sortMenuOpen]);
  useEffect(() => {
    try {
      localStorage.setItem(columnWidthStorageKey, JSON.stringify(columnWidths));
    } catch {
      // Column sizing still works for this session when browser storage is unavailable.
    }
  }, [columnWidths]);
  useEffect(() => {
    try {
      localStorage.setItem(gridPinStorageKey, JSON.stringify(gridPinPreferences));
    } catch {
      // Pinning remains available for this session when browser storage is unavailable.
    }
  }, [gridPinPreferences]);
  useEffect(() => {
    if (!saved.id || pinScopeKey.startsWith("report:")) return;
    const reportScope = `report:${saved.id}`;
    setGridPinPreferences((current) => {
      const draftPins = current[pinScopeKey];
      if (!draftPins) return current;
      const remaining = { ...current };
      delete remaining[pinScopeKey];
      return remaining[reportScope]
        ? remaining
        : { ...remaining, [reportScope]: draftPins };
    });
    setPinScopeKey(reportScope);
  }, [saved.id, pinScopeKey]);
  useEffect(() => {
    const stopDrag = () => {
      dragSelectionActiveRef.current = false;
      dragAnchorRef.current = null;
    };
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, []);
  useEffect(() => {
    let active = true;
    let request: AbortController | null = null;
    const checkHealth = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      try {
        const response = await apiFetch(apiUrl("/api/health"), {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as { ok?: boolean };
        if (active)
          setEngineStatus(
            response.ok && payload.ok === true ? "ready" : "offline",
          );
      } catch {
        if (active) setEngineStatus("offline");
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkHealth();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      request?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  function switchInputMode(next: "task" | "files") {
    if (next === inputMode) return;
    setInputMode(next);
  }
  async function loadPreview(file: File, kind: PreviewKind, sheetName = "") {
    const requestId = ++previewRequests.current[kind];
    setPreviews((current) => ({
      ...current,
      [kind]: { ...current[kind], loading: true, error: "" },
    }));
    const body = new FormData();
    body.append("file", file);
    if (sheetName) body.append("sheetName", sheetName);
    try {
      const response = await apiFetch(apiUrl("/api/files/preview"), {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as FilePreview & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message ?? "Không thể đọc file.");
      if (previewRequests.current[kind] !== requestId) return;
      setPreviews((current) => ({
        ...current,
        [kind]: { data: payload, loading: false, error: "" },
      }));
    } catch (caught) {
      if (previewRequests.current[kind] !== requestId) return;
      setPreviews((current) => ({
        ...current,
        [kind]: {
          ...current[kind],
          loading: false,
          error:
            caught instanceof Error ? caught.message : "Không thể đọc file.",
        },
      }));
    }
  }
  function selectTsv(file: File) {
    setTsv(file);
    setReportTitle(titleFromFile(file.name));
    void loadPreview(file, "tsv");
  }
  function selectXlsx(file: File) {
    setXlsx(file);
    void loadPreview(file, "xlsx");
  }

  async function analyze(forcedMapping?: ColumnMapping) {
    if (!tsv || !xlsx) {
      setError("Hãy chọn đủ hai file TSV và XLSX.");
      return;
    }
    setLoading(true);
    setLoadingMode("files");
    setLoadingProgress(null);
    setError("");
    const data = new FormData();
    data.append("tsv", tsv);
    data.append("xlsx", xlsx);
    data.append("title", reportTitle);
    if (forcedMapping) data.append("mapping", JSON.stringify(forcedMapping));
    try {
      const response = await apiFetch(apiUrl("/api/analyze"), {
        method: "POST",
        body: data,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.code === "COLUMN_MAPPING_REQUIRED") {
          setHeaders({ tsv: payload.tsvHeaders, excel: payload.excelHeaders });
          setMapping(payload.mapping);
          setMappingOpen(true);
          return;
        }
        throw new Error(payload.message ?? "Phân tích thất bại.");
      }
      saved.adopt(payload, reportTitle, [tsv, xlsx]);
      await attachImportedReport(payload as SavedResult);
      setPinScopeKey((payload as SavedResult).reportId
        ? `report:${(payload as SavedResult).reportId}`
        : payload.task
          ? `task:${payload.task}`
          : `draft:${crypto.randomUUID()}`);
      setGridSelection(null);
      setAllEditMode(false);
      setResult(payload);
      setStage("results");
      setPage("results");
      setReportTab("results");
      setMappingOpen(false);
      if (payload.saveWarning) setError(payload.saveWarning);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể kết nối máy chủ.",
      );
    } finally {
      setLoading(false);
      setLoadingMode(null);
      setLoadingProgress(null);
    }
  }

  async function importTask() {
    if (!taskUrl.trim()) {
      setError("Hãy nhập link GNPS2 Task.");
      return;
    }
    setLoading(true);
    setLoadingMode("task");
    setLoadingProgress({
      stage: "task", step: 1, totalSteps: 6, percent: 0,
      title: "Đang kết nối với GNPS2",
      message: "Đang gửi yêu cầu và chờ trạng thái task.",
      outcome: "working",
    });
    setError("");
    setStructureMessage("");
    try {
      const payload = await postProgressStream<AnalysisResult & {
        message?: string;
        title?: string;
        saveWarning?: string;
      }>(apiUrl("/api/gnps-task/import?progress=stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ url: taskUrl.trim() }),
      }, setLoadingProgress);
      saved.adopt(payload, payload.title || "GNPS2 Report");
      await attachImportedReport(payload as SavedResult);
      setPinScopeKey((payload as SavedResult).reportId
        ? `report:${(payload as SavedResult).reportId}`
        : payload.task
          ? `task:${payload.task}`
          : `draft:${crypto.randomUUID()}`);
      setGridSelection(null);
      setAllEditMode(false);
      if ((payload as SavedResult).saveWarning)
        setError((payload as SavedResult).saveWarning!);
      setResult(payload);
      setReportTitle(payload.title || "GNPS2 Report");
      setGnpsUrl(taskUrl.trim());
      setStage("results");
      setPage("results");
      setReportTab("results");
      setStructureMessage(
        `Đã tự động lấy ${payload.summary.structures ?? 0}/${payload.rows.length} ảnh cấu trúc và ${payload.summary.fragments ?? 0} phổ mảnh vỡ từ GNPS2.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể kết nối GNPS2.",
      );
    } finally {
      setLoading(false);
      setLoadingMode(null);
      setLoadingProgress(null);
    }
  }

  const metadataColumns = useMemo(() => {
    const present = new Set(
      (result?.rows ?? []).flatMap((row) =>
        Object.keys(row.sourceMetadata ?? {}),
      ),
    );
    const extras = [...present]
      .filter(
        (key) =>
          !preferredMetadataColumns.includes(
            key as (typeof preferredMetadataColumns)[number],
          ),
      )
      .sort((a, b) => a.localeCompare(b));
    return [...preferredMetadataColumns, ...extras];
  }, [result]);
  const metadataSortKinds = useMemo(
    () =>
      new Map(
        metadataColumns.map((column) => [
          column,
          inferSortKind(
            (result?.rows ?? []).map((row) => row.sourceMetadata?.[column]),
          ),
        ]),
      ),
    [metadataColumns, result],
  );
  const filtered = useMemo(() => {
    const rows = (result?.rows ?? []).filter((row) => {
      const text =
        `${row.compoundName} ${row.adduct} ${row.molecularFormula} ${Object.values(row.sourceMetadata ?? {}).join(" ")}`.toLowerCase();
      return (
        text.includes(query.toLowerCase()) &&
        (status === "all" ||
          (status === "selected" ? row.selected : row.status === status))
      );
    });
    if (!sort) return rows;
    const valueFor = (row: MatchRow): unknown => {
      if (sort.column.startsWith("metadata:"))
        return row.sourceMetadata?.[sort.column.slice(9)];
      return row[sort.column as keyof MatchRow];
    };
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = valueFor(left.row);
        const rightValue = valueFor(right.row);
        const leftEmpty = leftValue == null || String(leftValue).trim() === "";
        const rightEmpty =
          rightValue == null || String(rightValue).trim() === "";
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
        if (leftEmpty && rightEmpty) return left.index - right.index;
        const comparison =
          sort.kind === "number"
            ? (sortableNumber(leftValue) ?? 0) -
              (sortableNumber(rightValue) ?? 0)
            : vietnameseCollator.compare(String(leftValue), String(rightValue));
        return comparison === 0
          ? left.index - right.index
          : comparison * (sort.direction === "asc" ? 1 : -1);
      })
      .map((item) => item.row);
  }, [result, query, status, sort]);
  const pinnedRowIds = gridPinPreferences[pinScopeKey]?.rowIds ?? [];
  const pinnedColumnKeys = gridPinPreferences[pinScopeKey]?.columnKeys ?? [];
  const gridColumnKeys = useMemo(() => [
    "stt", "rtDisplay", "compoundName", "adduct", "mzTsv", "fragments",
    "molecularFormula", "reportedMzErrorPpm", "structure",
    ...metadataColumns.map((column) => `metadata:${column}`),
  ], [metadataColumns]);
  const visibleGridColumnKeys = useMemo(
    () => orderPinnedColumns(gridColumnKeys, pinnedColumnKeys, ["stt", "compoundName"]),
    [gridColumnKeys, pinnedColumnKeys],
  );
  const orderedFilteredRows = useMemo(
    () => orderPinnedRows(filtered, pinnedRowIds),
    [filtered, pinnedRowIds],
  );
  const pinnedVisibleRows = useMemo(
    () => orderedFilteredRows.filter((row) => pinnedRowIds.includes(row.id)),
    [orderedFilteredRows, pinnedRowIds],
  );
  const scrollingVisibleRows = useMemo(
    () => orderedFilteredRows.filter((row) => !pinnedRowIds.includes(row.id)),
    [orderedFilteredRows, pinnedRowIds],
  );
  const gridColumnCount = visibleGridColumnKeys.length;
  useEffect(() => {
    const head = gridHeadRef.current;
    if (!head) return;
    const measure = () => {
      const headerHeight = head.getBoundingClientRect().height;
      setGridHeaderHeight((current) => Math.abs(current - headerHeight) < 0.5 ? current : headerHeight);
      let top = headerHeight;
      const offsets: Record<string, number> = {};
      for (const row of pinnedVisibleRows) {
        offsets[row.id] = top;
        top += pinnedGridRowRefs.current.get(row.id)?.getBoundingClientRect().height ?? 44;
      }
      setPinnedGridRowOffsets((current) => {
        const keys = new Set([...Object.keys(current), ...Object.keys(offsets)]);
        for (const key of keys) if (Math.abs((current[key] ?? -1) - (offsets[key] ?? -1)) >= 0.5) return offsets;
        return current;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    for (const row of pinnedVisibleRows) {
      const element = pinnedGridRowRefs.current.get(row.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [pinnedVisibleRows, visibleGridColumnKeys, columnWidths]);
  const columnWidth = (key: string) =>
    columnWidths[key] ?? (key.startsWith("metadata:") ? 82 : defaultColumnWidths[key] ?? 82);
  const pinnedGridColumnLeft = (key: string) => {
    const index = visibleGridColumnKeys.indexOf(key);
    if (index < 0 || (index > 1 && !pinnedColumnKeys.includes(key))) return undefined;
    return 34 + visibleGridColumnKeys.slice(0, index).reduce((width, precedingKey) => width + columnWidth(precedingKey), 0);
  };
  const gridColumnClass = (key: string) => [
    key === "stt" ? "sticky-index" : "",
    key === "compoundName" ? "sticky-compound" : "",
    pinnedGridColumnLeft(key) != null ? "grid-column-pinned" : "",
  ].filter(Boolean).join(" ");
  const gridColumnStyle = (key: string) => {
    const left = pinnedGridColumnLeft(key);
    return left == null ? undefined : { left };
  };
  const columnResizer = (key: string, label: string) => (
    <span
      className="column-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Đổi độ rộng cột ${label}`}
      aria-valuenow={columnWidth(key)}
      tabIndex={0}
      onPointerDown={(event) => beginColumnResize(key, event)}
      onPointerMove={moveColumnResize}
      onPointerUp={finishColumnResize}
      onPointerCancel={finishColumnResize}
      onKeyDown={(event) => resizeColumnByKeyboard(key, event)}
      onClick={(event) => event.stopPropagation()}
    />
  );
  const selectGridCell = (
    row: number,
    column: number,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("button") || (target?.closest("input,textarea,select") && !(event.ctrlKey || event.metaKey || event.shiftKey))) return;
    event.preventDefault();
    tableWrapRef.current?.focus({ preventScroll: true });
    setCopyMessage("");
    const point = { row, column };
    if (event.ctrlKey || event.metaKey) {
      dragSelectionActiveRef.current = false;
      dragAnchorRef.current = null;
      setGridSelection((current) => toggleGridCellSelection(current, row, column));
      return;
    }
    const anchor = event.shiftKey && gridSelection ? gridSelection.anchor : point;
    dragAnchorRef.current = anchor;
    dragSelectionActiveRef.current = true;
    setGridSelection({ anchor, focus: point });
  };
  const handleGridEditorPointerDown = (row: number, column: number, event: ReactPointerEvent<HTMLInputElement>, selectCell = false) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      selectGridCell(row, column, event);
    } else if (selectCell) {
      const point = { row, column };
      dragAnchorRef.current = point;
      dragSelectionActiveRef.current = true;
      setCopyMessage("");
      setGridSelection({ anchor: point, focus: point });
    }
  };
  const extendGridDrag = (row: number, column: number, event: ReactPointerEvent<HTMLTableCellElement>) => {
    if (!dragSelectionActiveRef.current || !dragAnchorRef.current || event.buttons === 0) return;
    event.preventDefault();
    setGridSelection({ anchor: dragAnchorRef.current, focus: { row, column } });
  };
  const selectGridColumn = (column: number) => {
    if (!filtered.length) return;
    tableWrapRef.current?.focus({ preventScroll: true });
    setCopyMessage("");
    setGridSelection(makeGridColumnSelection(filtered.length, column));
  };
  const selectGridRow = (row: number) => {
    tableWrapRef.current?.focus({ preventScroll: true });
    setCopyMessage("");
    setGridSelection(makeGridRowSelection(row, gridColumnCount));
  };
  const beginColumnResize = (key: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeRef.current = { key, startX: event.clientX, startWidth: columnWidth(key) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const session = columnResizeRef.current;
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    const nextWidth = Math.max(minColumnWidth, Math.min(maxColumnWidth, session.startWidth + event.clientX - session.startX));
    setColumnWidths((current) => ({ ...current, [session.key]: nextWidth }));
  };
  const finishColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    columnResizeRef.current = null;
  };
  const resizeColumnByKeyboard = (key: string, event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const change = event.key === "ArrowLeft" ? -8 : 8;
    setColumnWidths((current) => ({
      ...current,
      [key]: Math.max(minColumnWidth, Math.min(maxColumnWidth, columnWidth(key) + change)),
    }));
  };
  const isGridCellSelected = (row: number, column: number) =>
    cellIsSelected(gridSelection, row, column);
  const isGridRowSelected = (row: number) => rowIsSelected(gridSelection, row);
  const selectedGridTargets = selectionRowAndColumnIndexes(
    gridSelection,
    orderedFilteredRows.length,
    visibleGridColumnKeys.length,
  );
  const selectedPinRowIds = selectedGridTargets.rows
    .map((index) => orderedFilteredRows[index]?.id)
    .filter((id): id is string => Boolean(id));
  const selectedPinColumnKeys = selectedGridTargets.columns
    .map((index) => visibleGridColumnKeys[index])
    .filter((key) => key && key !== "stt" && key !== "compoundName");
  const selectedRowsArePinned = selectedPinRowIds.length > 0 && selectedPinRowIds.every((id) => pinnedRowIds.includes(id));
  const selectedColumnsArePinned = selectedPinColumnKeys.length > 0 && selectedPinColumnKeys.every((key) => pinnedColumnKeys.includes(key));
  const updateCurrentGridPins = (patch: Partial<ReportGridPins>) => {
    setGridPinPreferences((current) => ({
      ...current,
      [pinScopeKey]: {
        rowIds: current[pinScopeKey]?.rowIds ?? [],
        columnKeys: current[pinScopeKey]?.columnKeys ?? [],
        ...patch,
      },
    }));
  };
  const toggleSelectedRowsPin = () => {
    if (!selectedPinRowIds.length) return;
    const current = new Set(pinnedRowIds);
    if (selectedRowsArePinned) selectedPinRowIds.forEach((id) => current.delete(id));
    else selectedPinRowIds.forEach((id) => current.add(id));
    updateCurrentGridPins({ rowIds: [...current] });
    setGridSelection(null);
  };
  const toggleSelectedColumnsPin = () => {
    if (!selectedPinColumnKeys.length) return;
    const current = new Set(pinnedColumnKeys);
    if (selectedColumnsArePinned) selectedPinColumnKeys.forEach((key) => current.delete(key));
    else selectedPinColumnKeys.forEach((key) => current.add(key));
    updateCurrentGridPins({ columnKeys: [...current] });
    setGridSelection(null);
  };
  const unpinAllGridItems = () => {
    updateCurrentGridPins({ rowIds: [], columnKeys: [] });
    setGridSelection(null);
  };
  const copyGridSelection = async () => {
    const copied = selectionToTsv(orderedFilteredRows, gridSelection, metadataColumns, visibleGridColumnKeys);
    if (!copied) return;
    try {
      await navigator.clipboard.writeText(copied.text);
      setCopyMessage(`Đã sao chép ${copied.rowCount} hàng × ${copied.columnCount} cột.`);
    } catch {
      setCopyMessage("Không thể truy cập clipboard. Hãy cho phép trình duyệt sao chép dữ liệu.");
    }
  };
  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    const isEditor = target instanceof HTMLElement && (
      target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    );
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      const compoundEditor = target instanceof HTMLInputElement && target.classList.contains("compound-name-input");
      const multipleGridCells = !!gridSelection && (gridSelection.cells
        ? gridSelection.cells.length > 1
        : gridSelection.anchor.row !== gridSelection.focus.row || gridSelection.anchor.column !== gridSelection.focus.column);
      const hasSelectedText = compoundEditor && target.selectionStart !== target.selectionEnd;
      if (!gridSelection || (isEditor && !compoundEditor) || (hasSelectedText && !multipleGridCells)) return;
      event.preventDefault();
      void copyGridSelection();
      return;
    }
    if (isEditor || !gridSelection || !orderedFilteredRows.length) return;
    if (event.key === "Tab") {
      const current = gridSelection.focus.row * gridColumnCount + gridSelection.focus.column;
      const next = current + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= orderedFilteredRows.length * gridColumnCount) return;
      event.preventDefault();
      const point = { row: Math.floor(next / gridColumnCount), column: next % gridColumnCount };
      setGridSelection({ anchor: point, focus: point });
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const deltaByKey: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const delta = deltaByKey[event.key] ?? [0, 0];
    setGridSelection(moveGridSelection(
      gridSelection,
      delta[0],
      delta[1],
      orderedFilteredRows.length,
      gridColumnCount,
      event.shiftKey,
    ));
  };
  const compareUrl = result ? gnpsCompareUrl(result, gnpsUrl || taskUrl) : "";
  const engineLabel =
    engineStatus === "ready"
      ? "Engine sẵn sàng"
      : engineStatus === "checking"
        ? "Đang kiểm tra"
        : "Engine mất kết nối";
  const selectedCount = result?.rows.filter((row) => row.selected).length ?? 0;
  const sortableHeader = (
    column: string,
    label: string,
    subtitle: string,
    kind: SortKind,
  ) => (
    <SortableHeader
      column={column}
      label={label}
      subtitle={subtitle}
      kind={kind}
      sort={sort}
      menuOpen={sortMenuOpen === column}
      onMenu={setSortMenuOpen}
      onSort={(nextSort) => {
        setGridSelection(null);
        setSort(nextSort);
      }}
    />
  );
  function update(id: string, patch: Partial<MatchRow>) {
    setResult((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === id ? { ...row, ...patch } : row,
            ),
          }
        : current,
    );
  }
  function updateMetadata(id: string, column: string, value: string | number | null) {
    setResult((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.id === id
        ? { ...row, sourceMetadata: { ...row.sourceMetadata, [column]: value } }
        : row),
    } : current);
  }
  function saveCompoundName(id: string) {
    const compoundName = compoundDraft.trim();
    update(id, { compoundName });
    setDetailRow((current) =>
      current?.id === id ? { ...current, compoundName } : current,
    );
    setGridSelection(null);
    setEditingCompoundId(null);
  }
  const pinnedColumnIndicator = (key: string) => pinnedColumnKeys.includes(key)
    ? <span className="grid-pin-indicator" role="img" aria-label="Cột đang ghim" title="Cột đang ghim">{icons.pin}</span>
    : null;
  const renderSortableGridHeader = (
    key: string,
    index: number,
    label: string,
    subtitle: string,
    kind: SortKind,
  ) => (
    <th
      className={`${gridColumnClass(key)} sortable-column grid-column-header`}
      style={gridColumnStyle(key)}
      onClick={() => selectGridColumn(index)}
      title={key === "compoundName" ? "Bấm để chọn toàn bộ cột Compound name rồi sao chép" : undefined}
    >
      {sortableHeader(key, label, subtitle, kind)}
      {pinnedColumnIndicator(key)}
      {columnResizer(key, label)}
    </th>
  );
  const renderGridColumnHeader = (key: string, index: number) => {
    if (key === "stt") return (
      <th className={`${gridColumnClass(key)} grid-column-header`} style={gridColumnStyle(key)} onClick={() => selectGridColumn(index)} title="Chọn cột số thứ tự để sao chép">
        <small className="table-heading-en">No.</small><span className="table-heading-vn">STT</span>
        {columnResizer(key, "STT")}
      </th>
    );
    if (key === "rtDisplay") return renderSortableGridHeader(key, index, "Thời gian lưu", "tR (min)", "number");
    if (key === "compoundName") return renderSortableGridHeader(key, index, "Tên hoạt chất dự đoán", "Compound name", "text");
    if (key === "adduct") return renderSortableGridHeader(key, index, "Ion / chất cộng", "Ion / adduct", "text");
    if (key === "mzTsv") return renderSortableGridHeader(key, index, "Ion tiền chất", "Precursor m/z", "number");
    if (key === "fragments") return renderSortableGridHeader(key, index, "Mảnh vỡ", "Fragments (m/z)", "text");
    if (key === "molecularFormula") return renderSortableGridHeader(key, index, "Công thức phân tử", "Molecular formula", "text");
    if (key === "reportedMzErrorPpm") return renderSortableGridHeader(key, index, "Sai số MZ", "MZ error (ppm)", "number");
    if (key === "structure") return (
      <th className={`${gridColumnClass(key)} grid-column-header`} style={gridColumnStyle(key)} onClick={() => selectGridColumn(index)}>
        <small className="table-heading-en">Structure</small><span className="table-heading-vn">Cấu trúc phân tử</span>
        {pinnedColumnIndicator(key)}{columnResizer(key, "cấu trúc phân tử")}
      </th>
    );
    const column = key.slice("metadata:".length);
    return (
      <th
        className={`metadata-heading ${gridColumnClass(key)} sortable-column grid-column-header`}
        key={key}
        title={column}
        style={gridColumnStyle(key)}
        onClick={() => selectGridColumn(index)}
      >
        {sortableHeader(`metadata:${column}`, metadataHeaderLabel(column), column, metadataSortKinds.get(column) ?? "text")}
        {pinnedColumnIndicator(key)}{columnResizer(key, metadataHeaderLabel(column))}
      </th>
    );
  };
  const gridCellStyle = (key: string, row: MatchRow, pinnedRow: boolean): CSSProperties => {
    const style: CSSProperties = { ...(gridColumnStyle(key) ?? {}) };
    if (pinnedRow) {
      const fallbackOffset = gridHeaderHeight + Math.max(0, pinnedVisibleRows.findIndex((item) => item.id === row.id)) * 44;
      style.top = pinnedGridRowOffsets[row.id] ?? fallbackOffset;
    }
    return style;
  };
  const renderGridDataCell = (
    row: MatchRow,
    rowIndex: number,
    key: string,
    columnIndex: number,
    pinnedRow: boolean,
  ) => {
    const selected = isGridCellSelected(rowIndex, columnIndex);
    const pinnedClassName = `${gridColumnClass(key)} ${pinnedRow ? "grid-row-pinned-cell" : ""}`;
    const style = gridCellStyle(key, row, pinnedRow);
    const pointerProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLTableCellElement>) => selectGridCell(rowIndex, columnIndex, event),
      onPointerEnter: (event: ReactPointerEvent<HTMLTableCellElement>) => extendGridDrag(rowIndex, columnIndex, event),
    };
    const selectionClassName = selected ? "grid-cell-selected" : "";
    if (key === "stt") return (
      <td
        className={`mono faint grid-cell grid-row-header ${pinnedClassName} ${isGridRowSelected(rowIndex) ? "grid-cell-selected" : ""}`}
        style={style}
        onClick={() => selectGridRow(rowIndex)}
        title={pinnedRow ? "Hàng đang ghim. Chọn hàng để sao chép" : "Chọn hàng để sao chép"}
      >
        {rowIndex + 1}{pinnedRow && <span className="grid-pin-indicator" role="img" aria-label="Hàng đang ghim" title="Hàng đang ghim">{icons.pin}</span>}
      </td>
    );
    if (key === "rtDisplay") return (
      <td className={`rt-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.rtDisplay} {...pointerProps}>
        {allEditMode
          ? <GridEditInput className="grid-edit-input" value={row.rtDisplay} aria-label={`Sửa thời gian lưu dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { rtDisplay: String(value ?? "") })} />
          : <span className="readonly-cell-content mono">{row.rtDisplay || "—"}</span>}
      </td>
    );
    if (key === "compoundName") return (
      <td className={`wrapping-cell compound-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.compoundName} {...pointerProps}>
        <input className="grid-edit-input compound-name-input" value={row.compoundName} aria-label={`Tên hoạt chất dòng ${rowIndex + 1}`} onFocus={() => {
          const point = { row: rowIndex, column: columnIndex };
          setGridSelection({ anchor: point, focus: point });
        }} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event, true)} onChange={(event) => {
          update(row.id, { compoundName: event.target.value });
          setDetailRow((current) => current?.id === row.id ? { ...current, compoundName: event.target.value } : current);
        }} />
      </td>
    );
    if (key === "adduct") return (
      <td className={`grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.adduct} {...pointerProps}>
        {allEditMode ? <GridEditInput className="grid-edit-input" value={row.adduct} aria-label={`Sửa ion / chất cộng dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { adduct: String(value ?? "") })} /> : <span className="readonly-cell-content mono">{row.adduct || "—"}</span>}
      </td>
    );
    if (key === "mzTsv") return (
      <td className={`grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.mzTsv == null ? "" : String(row.mzTsv)} {...pointerProps}>
        {allEditMode ? <GridEditInput className="grid-edit-input mono" type="number" value={row.mzTsv} aria-label={`Sửa ion tiền chất dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { mzTsv: Number(value) || 0 })} /> : <span className="readonly-cell-content mono">{row.mzTsv ?? "—"}</span>}
      </td>
    );
    if (key === "fragments") return (
      <td className={`wrapping-cell fragments-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.fragments} {...pointerProps}>
        {allEditMode ? <GridEditInput className="grid-edit-input mono" value={row.fragments} aria-label={`Sửa mảnh vỡ dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { fragments: String(value ?? "") })} /> : <span className="readonly-cell-content mono">{row.fragments || "—"}</span>}
      </td>
    );
    if (key === "molecularFormula") return (
      <td className={`formula-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.molecularFormula} {...pointerProps}>
        {allEditMode ? <GridEditInput className="grid-edit-input mono" value={row.molecularFormula} aria-label={`Sửa công thức phân tử dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { molecularFormula: String(value ?? "") })} /> : <span className="readonly-cell-content mono">{row.molecularFormula || "—"}</span>}
      </td>
    );
    if (key === "reportedMzErrorPpm") return (
      <td className={`ppm-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.reportedMzErrorPpm == null ? "" : String(row.reportedMzErrorPpm)} {...pointerProps}>
        {allEditMode ? <GridEditInput className="grid-edit-input mono" type="number" value={row.reportedMzErrorPpm} aria-label={`Sửa sai số MZ dòng ${rowIndex + 1}`} onPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)} onChange={(value) => update(row.id, { reportedMzErrorPpm: typeof value === "number" ? value : null })} /> : <span className="readonly-cell-content mono">{row.reportedMzErrorPpm ?? "—"}</span>}
      </td>
    );
    if (key === "structure") return (
      <td className={`structure-cell grid-cell ${pinnedClassName} ${selectionClassName}`} style={style} title={row.structureUrl || "Chưa tra cứu"} {...pointerProps}>
        {row.structureData ? <button className="structure-preview" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
          event.stopPropagation();
          setDetailRow(row);
        }} aria-label={`Xem chi tiết ${row.compoundName}`}>
          <img loading="lazy" src={row.structureData} alt={`Cấu trúc ${row.compoundName}`} /><small>Xem chi tiết</small>
        </button> : <span>Chưa tra cứu</span>}
      </td>
    );
    const column = key.slice("metadata:".length);
    return (
      <MetadataCell
        key={key}
        value={row.sourceMetadata?.[column]}
        selected={selected}
        editing={allEditMode}
        numeric={metadataSortKinds.get(column) === "number"}
        onChange={(value) => updateMetadata(row.id, column, value)}
        onPointerDown={pointerProps.onPointerDown}
        onPointerEnter={pointerProps.onPointerEnter}
        onEditorPointerDown={(event) => handleGridEditorPointerDown(rowIndex, columnIndex, event)}
        className={`${pinnedClassName} ${selectionClassName}`}
        style={style}
      />
    );
  };
  async function openReport(payload: SavedResult, discard = false) {
    pendingProject.current=null;
    if (!discard && saved.dirty()) await saved.saveNow();
    setGridSelection(null);
    setAllEditMode(false);
    setEditingCompoundId(null);
    setResult(payload);
    setPinScopeKey(payload.reportId ? `report:${payload.reportId}` : `draft:${crypto.randomUUID()}`);
    setReportTitle(payload.title || "GNPS2 Report");
    saved.adopt(payload, payload.title || "GNPS2 Report");
    setStage("results");
    setPage("results");
    setReportTab("results");
    setGnpsUrl(
      payload.sourceUrl ||
        (payload.task
          ? `https://gnps2.org/result?task=${payload.task}&viewname=librarymatches`
          : ""),
    );
    setTsv(null);
    setXlsx(null);
    setViewerTarget(null);
    setDetailRow(null);
    setGnpsViewerOpen(false);
    setSort(null);
    setQuery("");
    setStatus("all");
    setPreviews({
      tsv: { data: null, loading: false, error: "" },
      xlsx: { data: null, loading: false, error: "" },
    });
    setError("");
    previewRequests.current.tsv++;
    previewRequests.current.xlsx++;
    setSourceLoading(true);
    try {
      const assets = await jsonApi<{ items: StoredAsset[] }>(
        `/api/reports/${payload.reportId}/assets`,
      );
      for (const asset of assets.items.filter(
        (a) =>
          a.state === "ready" && ["source_tsv", "source_xlsx"].includes(a.kind),
      )) {
        const response = await apiFetch(
          apiUrl(
            `/api/reports/${payload.reportId}/assets/${asset.id}/download`,
          ),
        );
        if (!response.ok) throw new Error("Không tải được file nguồn.");
        const file = new File([await response.blob()], asset.name),
          kind = asset.kind === "source_tsv" ? "tsv" : "xlsx";
        if (kind === "tsv") setTsv(file);
        else setXlsx(file);
        void loadPreview(file, kind);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSourceLoading(false);
    }
  }
  async function doExport(type: "docx" | "xlsx") {
    if (!result) return;
    setExporting(type);
    setError("");
    try {
      await saved.saveNow();
      const id = saved.getId();
      if (!id) throw new Error("Cần lưu báo cáo trước khi xuất.");
      const failed = await download(
        `/api/reports/${id}/export/${type}`,
        saved.getRevision(),
        type,
        reportTitle,
      );
      if (failed)
        setError(
          "Đã xuất file để tải về, nhưng chưa lưu được bản xuất lên Cloudinary.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xuất file thất bại.");
    } finally {
      setExporting("");
    }
  }
  async function resolveStructures() {
    if (!result || !gnpsUrl.trim()) return;
    const targets = result.rows.filter((row) => row.selected);
    if (!targets.length) return;
    setStructureLoading(true);
    setError("");
    setStructureMessage("");
    try {
      const response = await apiFetch(apiUrl("/api/structures/gnps2"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gnpsUrl.trim(),
          rows: targets.map(({ id, compoundName }) => ({ id, compoundName })),
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        resolved: Array<{ id: string; structureData?: string }>;
        found: number;
        libraryMatches: number;
      };
      if (!response.ok) throw new Error(payload.message);
      const map = new Map<string, string | undefined>(
        payload.resolved.map((item) => [item.id, item.structureData]),
      );
      setResult({
        ...result,
        rows: result.rows.map((row) =>
          targets.some((target) => target.id === row.id)
            ? { ...row, structureData: map.get(row.id) }
            : row,
        ),
      });
      setStructureMessage(
        `Đã lấy ${payload.found}/${targets.length} ảnh từ ${payload.libraryMatches} Library Matches. Dòng không có ảnh được để trống.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tra cứu PubChem.");
    } finally {
      setStructureLoading(false);
    }
  }

  async function navigate(next: WorkspacePage) {
    pendingProject.current=null;
    if (loading || sourceLoading || exporting || structureLoading)
      throw new Error("Hãy đợi thao tác hiện tại hoàn tất.");
    if (saved.dirty()) await saved.saveNow();

    if (next === "dashboard") {
      goHome();
      return;
    }
    if (next === "upload") {
      setGridSelection(null);
      setAllEditMode(false);
      setEditingCompoundId(null);
      setResult(null);
      setStage("upload");
      setTsv(null);
      setXlsx(null);
      setTaskUrl("");
      setGnpsUrl("");
      setReportTitle("");
      setPreviews({
        tsv: { data: null, loading: false, error: "" },
        xlsx: { data: null, loading: false, error: "" },
      });
      previewRequests.current.tsv++;
      previewRequests.current.xlsx++;
    }
    setViewerTarget(null);
    setGnpsViewerOpen(false);
    setDetailRow(null);
    setError("");
    setPage(next);
  }
  useEditorDialogs(!!detailRow || mappingOpen, () => {
    setDetailRow(null);
    setMappingOpen(false);
  });
  return (
    <WorkspaceShell
      page={page}
      onNavigate={navigate}
      onOpenReport={async (id) =>
        openReport(await jsonApi<SavedResult>(`/api/reports/${id}`), true)
      }
      activeReportId={saved.id}
      reportsRefresh={saved.refresh + reportListRevision}
      engineStatus={engineStatus}
      dirty={saved.dirty}
      saveNow={saved.saveNow}
      locked={loading || sourceLoading || !!exporting || structureLoading}
    >
      {page === "reports" && (
        <ReportLibrary
          onOpen={openReport}
          onCreate={() =>
            void navigate("upload").catch((e) => setError(e.message))
          }
          onDeleted={(id) => {
            setReportListRevision((revision) => revision + 1);
            if (saved.getId() === id) {
              setResult(null);
              setStage("upload");
            }
          }}
        />
      )}
      {page === "account" && <AccountPage />}
      {(page === 'research' || page === 'ai-settings') && (
        <section className="research-page" aria-labelledby="ai-coming-soon-title">
          <h1 id="ai-coming-soon-title">AI chat</h1>
          <p>Coming soon</p>
          <p>Trợ lý nghiên cứu theo project và phiên làm việc sẽ được mở trong thời gian tới.</p>
        </section>
      )}
      <AnimatePresence mode="wait">
        {page === "upload" ? (
          <motion.section
            className="import-page"
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="page-heading">
              <div>
                <span className="eyebrow">PHÂN TÍCH MỚI · GNPS2</span>
                <h1>Tạo báo cáo mới</h1>
                <p>Chọn nguồn dữ liệu để bắt đầu phân tích và lưu báo cáo.</p>
              </div>
            </div>
            <div className="import-layout">
              <section className="import-form">
                <div
                  className="source-tabs"
                  onKeyDown={tabKeys}
                  role="tablist"
                  aria-label="Nguồn dữ liệu"
                >
                  <button
                    id="source-task-tab"
                    role="tab"
                    aria-selected={inputMode === "task"}
                    aria-controls="source-task-panel"
                    className={inputMode === "task" ? "active" : ""}
                    onClick={() => switchInputMode("task")}
                  >
                    <Icon name="link" />
                    Link GNPS2
                  </button>
                  <button
                    id="source-files-tab"
                    role="tab"
                    aria-selected={inputMode === "files"}
                    aria-controls="source-files-panel"
                    className={inputMode === "files" ? "active" : ""}
                    onClick={() => switchInputMode("files")}
                  >
                    <Icon name="file" />
                    TSV + XLSX
                  </button>
                </div>
                <div
                  id="source-task-panel"
                  role="tabpanel"
                  aria-labelledby="source-task-tab"
                  hidden={inputMode !== "task"}
                  className="task-import-card"
                >
                  <div className="task-import-copy">
                    <span>{icons.search}</span>
                    <div>
                      <strong>GNPS2 Task tự động</strong>
                      <small>
                        Đọc Library Matches, RT, fragments và cấu trúc.
                      </small>
                    </div>
                  </div>
                  <label>
                    <span>LINK STATUS / RESULT / NETWORK</span>
                    <input
                      type="url"
                      value={taskUrl}
                      onChange={(e) => setTaskUrl(e.target.value)}
                      placeholder="https://gnps2.org/status?task=..."
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={loading || !taskUrl.trim()}
                    onClick={importTask}
                  >
                    {loading ? <span className="spinner" /> : icons.flask}
                    {loading ? "Đang đọc GNPS2…" : "Đọc dữ liệu GNPS2"}
                    <small>→</small>
                  </button>
                  <div className="task-stages">
                    <span>1. Task & tiêu đề</span>
                    <i /> <span>2. Library Matches</span>
                    <i /> <span>3. Network & RT</span>
                    <i /> <span>4. Ảnh cấu trúc</span>
                  </div>
                </div>
                <div
                  id="source-files-panel"
                  role="tabpanel"
                  aria-labelledby="source-files-tab"
                  hidden={inputMode !== "files"}
                  className="files-panel"
                >
                  <div className="file-import-controls">
                    <div className="upload-grid">
                      <FileDrop
                        accept=".tsv"
                        label="Kết quả định danh GNPS"
                        hint="Kéo thả hoặc nhấn để chọn file TSV"
                        file={tsv}
                        onFile={selectTsv}
                      />
                      <FileDrop
                        accept=".xlsx"
                        label="Dữ liệu thực nghiệm"
                        hint="Kéo thả hoặc nhấn để chọn Data.xlsx"
                        file={xlsx}
                        onFile={selectXlsx}
                      />
                    </div>
                    <label className="title-field">
                      <span>
                        <b>TIÊU ĐỀ BÁO CÁO</b>
                        <small>
                          Tự nhận diện từ tên file TSV — bạn có thể sửa lại
                        </small>
                      </span>
                      <input
                        value={reportTitle}
                        onChange={(e) => setReportTitle(e.target.value)}
                        placeholder="Chọn file TSV để tự nhận diện tiêu đề"
                        maxLength={160}
                      />
                      <i>{reportTitle.length}/160</i>
                    </label>
                    <div className="settings-card compact-action">
                      <div className="settings-title">
                        <span>{icons.tune}</span>
                        <div>
                          <strong>Đối chiếu theo tên hợp chất</strong>
                          <small>
                            Compound_Name ↔ library_compound_name, lấy tR từ
                            rt_min
                          </small>
                        </div>
                      </div>
                      <button
                        className="primary"
                        disabled={
                          loading || !tsv || !xlsx || !reportTitle.trim()
                        }
                        onClick={() => analyze()}
                      >
                        {loading ? <span className="spinner" /> : icons.flask}
                        {loading ? "Đang đối chiếu…" : "Bắt đầu đối chiếu"}
                        <small>→</small>
                      </button>
                    </div>
                  </div>
                </div>
                {error && (
                  <div className="ui-alert" role="alert">
                    <Icon name="alert" />
                    {error}
                  </div>
                )}
              </section>
              <aside className="import-guide">
                <span className="panel-icon">
                  <Icon name="reports" />
                </span>
                <h2>Dữ liệu vào. Báo cáo ra.</h2>
                <ol>
                  <li>
                    <span>01</span>
                    <div>
                      <strong>Nhập dữ liệu nguồn</strong>
                      <p>Link task GNPS2 hoặc file TSV và Excel thực nghiệm.</p>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <strong>Kiểm tra và hiệu chỉnh</strong>
                      <p>
                        Đối chiếu hoạt chất, thời gian lưu và cấu trúc phân tử.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <strong>Lưu và xuất báo cáo</strong>
                      <p>
                        Tiếp tục chỉnh sửa bất cứ lúc nào. Xuất Word hoặc Excel.
                      </p>
                    </div>
                  </li>
                </ol>
                <div className="settings-note">
                  <Icon name="check" />
                  Báo cáo được lưu riêng theo tài khoản.
                </div>
                <small>
                  File tối đa 9,5 MB · 1.000 dòng/báo cáo theo cấu hình mặc
                  định.
                </small>
              </aside>
            </div>
          </motion.section>
        ) : page === "results" && result ? (
          <motion.section
            key="results"
            className="results-page"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="report-heading">
              <div>
                <span className="eyebrow">BÁO CÁO PHÂN TÍCH</span>
                <label className="result-title-label">
                  <span className="sr-only">Tiêu đề báo cáo</span>
                  <input
                    aria-label="Tiêu đề báo cáo"
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    maxLength={160}
                    placeholder="Tên báo cáo"
                  />
                </label>
                <div className="report-meta">
                  <span
                    className={`save-badge ${saveBadgeState}`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    title={saved.errorMessage || saveBadgeLabel}
                  >
                    {saved.saving ? (
                      <span className="ui-spinner" aria-hidden="true" />
                    ) : saveBadgeState === "saved" ? (
                      <Icon name="check" />
                    ) : saveBadgeState === "error" ||
                      saveBadgeState === "partial" ||
                      saveBadgeState === "conflict" ? (
                      <Icon name="alert" />
                    ) : (
                      <i />
                    )}
                    <span>{saveBadgeLabel}</span>
                  </span>
                  {saved.savedAt && (
                    <time
                      className="save-time"
                      dateTime={saved.savedAt}
                      title={new Date(saved.savedAt).toLocaleString("vi-VN")}
                    >
                      Lưu gần nhất {formatSavedAt(saved.savedAt)}
                    </time>
                  )}
                  {(saveBadgeState === "error" ||
                    saveBadgeState === "partial") &&
                    saved.errorMessage && (
                      <span className="save-detail">
                        {saved.errorMessage}
                      </span>
                    )}
                  <span>
                    {result.rows.length.toLocaleString("vi-VN")} dòng ·{" "}
                    {result.source === "gnps-task"
                      ? "GNPS2 Task"
                      : "TSV + XLSX"}
                  </span>
                </div>
              </div>
              <div className="export-actions">
                <button
                  className="ui-button save-button"
                  onClick={() =>
                    void saved
                      .saveNow("manual")
                      .catch((e) => setError(e.message))
                  }
                  disabled={!saved.dirty() || saved.saving || saved.conflict}
                  aria-busy={saved.saving}
                  title={
                    saved.conflict
                      ? "Tải lại báo cáo trước khi lưu"
                      : !saved.dirty()
                        ? "Tất cả thay đổi đã được lưu"
                        : undefined
                  }
                >
                  {saved.saving ? (
                    <span className="ui-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="check" />
                  )}
                  {saved.saving
                    ? "Đang lưu…"
                    : saved.status === "error"
                      ? "Thử lưu lại"
                      : "Lưu ngay"}
                </button>
                <button
                  className="ui-button"
                  onClick={() => void doExport("xlsx")}
                  disabled={!!exporting}
                  aria-busy={exporting === "xlsx"}
                >
                  {exporting === "xlsx" ? (
                    <span className="ui-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="download" />
                  )}
                  {exporting === "xlsx" ? "Đang tạo…" : "Xuất Excel"}
                </button>
                <button
                  className="ui-button primary"
                  onClick={() => void doExport("docx")}
                  disabled={!!exporting || !reportTitle.trim()}
                  aria-busy={exporting === "docx"}
                >
                  {exporting === "docx" ? (
                    <span className="ui-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="download" />
                  )}
                  {exporting === "docx" ? "Đang tạo…" : "Xuất Word"}
                </button>
              </div>
            </div>
            {saved.conflict && saved.id && (
              <div className="ui-alert conflict-alert" role="alert">
                <Icon name="alert" />
                <div>
                  <strong>Báo cáo đã thay đổi ở nơi khác</strong>
                  <p>
                    Tải bản đã lưu để tiếp tục. Thay đổi chưa lưu tại đây sẽ bị
                    bỏ.
                  </p>
                </div>
                <button
                  className="ui-button"
                  onClick={() =>
                    void ask({
                      title: "Tải bản đã lưu?",
                      message:
                        "Thay đổi cục bộ chưa lưu sẽ bị bỏ. Báo cáo trên hệ thống không bị thay đổi.",
                      accept: "Tải lại báo cáo",
                    }).then((ok) => {
                      if (ok)
                        void jsonApi<SavedResult>(`/api/reports/${saved.id}`)
                          .then((payload) => openReport(payload, true))
                          .catch((e) => setError(e.message));
                    })
                  }
                >
                  Tải lại bản đã lưu
                </button>
              </div>
            )}
            {error && (
              <div className="ui-alert" role="alert">
                <Icon name="alert" />
                <span>{error}</span>
                <button
                  onClick={() => setError("")}
                  aria-label="Đóng thông báo"
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            <div
              className="report-tabs"
              onKeyDown={tabKeys}
              role="tablist"
              aria-label="Nội dung báo cáo"
            >
              <button
                id="report-results-tab"
                role="tab"
                aria-selected={reportTab === "results"}
                aria-controls="report-results-panel"
                onClick={() => setReportTab("results")}
                className={reportTab === "results" ? "active" : ""}
              >
                <Icon name="grid" />
                Kết quả phân tích
              </button>
              <button
                id="report-assets-tab"
                role="tab"
                aria-selected={reportTab === "assets"}
                aria-controls="report-assets-panel"
                onClick={() => setReportTab("assets")}
                className={reportTab === "assets" ? "active" : ""}
              >
                <Icon name="file" />
                Ảnh và file
              </button>
            </div>
            <div
              id="report-assets-panel"
              role="tabpanel"
              aria-labelledby="report-assets-tab"
              hidden={reportTab !== "assets"}
            >
              {reportTab === "assets" &&
                (saved.id ? (
                  <AssetsPanel
                    id={saved.id}
                    refresh={saved.refresh + Number(!!exporting)}
                    onError={setError}
                    onRecovered={() =>
                      void saved
                        .refreshMedia()
                        .catch((e) => setError(e.message))
                    }
                  />
                ) : (
                  <EmptyState
                    title="Lưu báo cáo để quản lý file"
                    description="Sau khi lưu kết quả, ảnh và file nguồn sẽ được liên kết với báo cáo này."
                    icon="file"
                  />
                ))}
            </div>
            <div
              id="report-results-panel"
              role="tabpanel"
              aria-labelledby="report-results-tab"
              hidden={reportTab !== "results"}
            >
              <div className="report-source-toolbar">
                <span>
                  {sourceLoading ? "Đang tải file nguồn…" : "NGUỒN & ĐỐI CHIẾU"}
                </span>
                <div>
                  {result.source !== "gnps-task" && (
                    <>
                      <button
                        className={
                          viewerTarget === "tsv" ? "viewer-action active" : ""
                        }
                        disabled={!tsv}
                        onClick={() => {
                          setGnpsViewerOpen(false);
                          setViewerTarget(
                            viewerTarget === "tsv" ? null : "tsv",
                          );
                        }}
                      >
                        {icons.file} Xem TSV
                      </button>
                      <button
                        className={
                          viewerTarget === "xlsx" ? "viewer-action active" : ""
                        }
                        disabled={!xlsx}
                        onClick={() => {
                          setGnpsViewerOpen(false);
                          setViewerTarget(
                            viewerTarget === "xlsx" ? null : "xlsx",
                          );
                        }}
                      >
                        {icons.file} Xem XLSX
                      </button>
                      <button
                        onClick={() => {
                          setHeaders({
                            tsv: result.tsvHeaders,
                            excel: result.excelHeaders,
                          });
                          setMapping(result.mapping);
                          setMappingOpen(true);
                        }}
                      >
                        {icons.tune} Ánh xạ lại
                      </button>
                    </>
                  )}
                  <button
                    className={
                      gnpsViewerOpen ? "viewer-action active" : "viewer-action"
                    }
                    disabled={!compareUrl}
                    onClick={() => {
                      setViewerTarget(null);
                      setGnpsViewerOpen((value) => !value);
                    }}
                  >
                    {icons.external} Đối chiếu GNPS
                  </button>
                </div>
              </div>
              <details className="structure-tools">
                <summary>
                  <Icon name="link" />
                  Bổ sung ảnh cấu trúc từ GNPS2<span>Library Matches</span>
                </summary>
                <div className="gnps-card">
                  <div>
                    <strong>Ảnh cấu trúc từ GNPS2</strong>
                    <small>
                      Dán URL trang Library Matches. Không tìm thấy cấu trúc sẽ
                      để trống.
                    </small>
                  </div>
                  <input
                    type="url"
                    value={gnpsUrl}
                    onChange={(e) => setGnpsUrl(e.target.value)}
                    placeholder="https://gnps2.org/result?task=...&viewname=librarymatches"
                  />
                  <button
                    onClick={resolveStructures}
                    disabled={structureLoading || !gnpsUrl.trim()}
                  >
                    {structureLoading ? (
                      <span className="spinner" />
                    ) : (
                      icons.flask
                    )}
                    {structureLoading ? "Đang lấy ảnh…" : "Lấy ảnh GNPS2"}
                  </button>
                </div>
              </details>
              {structureMessage && (
                <motion.div
                  className="notice"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <span>{icons.check}</span>
                  <p>{structureMessage}</p>
                  <button
                    onClick={() => setStructureMessage("")}
                    aria-label="Đóng thông báo"
                  >
                    {icons.close}
                  </button>
                </motion.div>
              )}
              <div className="stats">
                <article>
                  <small>DÒNG TSV</small>
                  <strong>{result.summary.tsvRows}</strong>
                  <span>Dữ liệu nguồn</span>
                </article>
                <article>
                  <small>ĐÃ ĐỐI CHIẾU</small>
                  <strong>{result.summary.matched}</strong>
                  <span className="green">✓ Tìm thấy tên</span>
                </article>
                <article>
                  <small>CHƯA KHỚP</small>
                  <strong>{result.summary.unmatched}</strong>
                  <span>Không tìm thấy tên Excel</span>
                </article>
                <article>
                  <small>CẦN DUYỆT</small>
                  <strong>
                    {result.rows.filter((r) => r.status === "ambiguous").length}
                  </strong>
                  <span className="amber">Nhiều tên tương ứng</span>
                </article>
                <article>
                  <small>ĐÃ CHỌN</small>
                  <strong>{selectedCount}</strong>
                  <span>Sẽ đưa vào báo cáo</span>
                </article>
              </div>
              <div
                className={`results-workbench ${viewerTarget || gnpsViewerOpen ? "viewer-open" : ""}`}
              >
                <div className="data-card">
                  <div className="table-tools">
                    <div className="search">
                      {icons.search}
                      <input
                        aria-label="Tìm trong kết quả phân tích"
                        placeholder="Tìm trong tất cả trường dữ liệu…"
                        value={query}
                        onChange={(e) => {
                          setGridSelection(null);
                          setQuery(e.target.value);
                        }}
                      />
                    </div>
                    <div className="filters">
                      {(
                        [
                          "all",
                          "matched",
                          "ambiguous",
                          "unmatched",
                          "selected",
                        ] as const
                      ).map((value) => (
                        <button
                          className={status === value ? "active" : ""}
                          onClick={() => {
                            setGridSelection(null);
                            setStatus(value);
                          }}
                          key={value}
                        >
                          {
                            {
                              all: "Tất cả",
                              matched: "Khớp",
                              ambiguous: "Cần duyệt",
                              unmatched: "Chưa có RT",
                              selected: "Đã chọn",
                            }[value]
                          }
                        </button>
                      ))}
                    </div>
                    <button
                      className={`table-copy-button table-edit-all-button ${allEditMode ? "active" : ""}`}
                      type="button"
                      aria-pressed={allEditMode}
                      onClick={() => setAllEditMode((active) => !active)}
                      title={allEditMode ? "Kết thúc chỉnh sửa các trường" : "Mở chỉnh sửa tất cả trường dữ liệu"}
                    >
                      <span className="table-action-label">
                        <b>{allEditMode ? "Finish editing" : "Edit all"}</b>
                        <small>{allEditMode ? "Xong chỉnh sửa" : "Sửa tất cả"}</small>
                      </span>
                    </button>
                    <button
                      className="table-copy-button table-pin-button"
                      type="button"
                      disabled={!selectedPinRowIds.length}
                      onClick={toggleSelectedRowsPin}
                      aria-label={selectedRowsArePinned ? "Bỏ ghim hàng đang chọn" : "Ghim hàng đang chọn"}
                      title={selectedRowsArePinned ? "Bỏ ghim các hàng đang chọn" : "Ghim các hàng đang chọn"}
                    >
                      {icons.pin}<span className="table-action-label"><b>{selectedRowsArePinned ? "Unpin rows" : "Pin rows"}</b><small>{selectedRowsArePinned ? "Bỏ ghim hàng" : "Ghim hàng"}</small></span>
                    </button>
                    <button
                      className="table-copy-button table-pin-button"
                      type="button"
                      disabled={!selectedPinColumnKeys.length}
                      onClick={toggleSelectedColumnsPin}
                      aria-label={selectedColumnsArePinned ? "Bỏ ghim cột đang chọn" : "Ghim cột đang chọn"}
                      title={selectedColumnsArePinned ? "Bỏ ghim các cột đang chọn" : "Ghim các cột đang chọn"}
                    >
                      {icons.pin}<span className="table-action-label"><b>{selectedColumnsArePinned ? "Unpin columns" : "Pin columns"}</b><small>{selectedColumnsArePinned ? "Bỏ ghim cột" : "Ghim cột"}</small></span>
                    </button>
                    <button
                      className="table-copy-button table-pin-button"
                      type="button"
                      disabled={!pinnedRowIds.length && !pinnedColumnKeys.length}
                      onClick={unpinAllGridItems}
                      title="Bỏ ghim hàng và cột đã ghim thêm; STT và tên hoạt chất vẫn cố định"
                    >
                      <span className="table-action-label"><b>Unpin all</b><small>Bỏ ghim tất cả</small></span>
                    </button>
                    <button
                      className="table-copy-button"
                      type="button"
                      disabled={!gridSelection}
                      onClick={() => void copyGridSelection()}
                      title="Sao chép vùng đang chọn để dán vào Excel"
                    >
                      {icons.copy}<span className="table-action-label"><b>Copy selection</b><small>Sao chép vùng chọn</small></span>
                    </button>
                    <span className="result-count">
                      {filtered.length} kết quả · {metadataColumns.length}{" "}
                      trường nguồn
                    </span>
                  </div>
                  {copyMessage && <span className="table-copy-status" role="status" aria-live="polite">{copyMessage}</span>}
                  <div
                    className="table-wrap result-table-wrap"
                    ref={tableWrapRef}
                    tabIndex={0}
                    onKeyDown={handleGridKeyDown}
                    aria-label="Bảng kết quả. Chọn ô, tiêu đề để chọn cột hoặc số thứ tự để chọn hàng; nhấn Ctrl+C để sao chép."
                  >
                    <table className="result-table">
                      <colgroup>
                        <col style={{ width: 34 }} />
                        {visibleGridColumnKeys.map((key) => <col key={key} style={{ width: columnWidth(key) }} />)}
                      </colgroup>
                      <thead ref={gridHeadRef}>
                        <tr>
                          <th className="sticky-select">
                            <input
                              type="checkbox"
                              aria-label="Chọn tất cả dòng báo cáo"
                              title="Chọn các dòng sẽ đưa vào báo cáo"
                              checked={selectedCount === result.rows.length && !!selectedCount}
                              onChange={(event) => {
                                setGridSelection(null);
                                setResult({
                                  ...result,
                                  rows: result.rows.map((row) => ({ ...row, selected: event.target.checked })),
                                });
                              }}
                            />
                          </th>
                          {visibleGridColumnKeys.map((key, index) => <Fragment key={key}>{renderGridColumnHeader(key, index)}</Fragment>)}
                        </tr>
                      </thead>
                      {pinnedVisibleRows.length > 0 && (
                        <tbody className="grid-pinned-rows">
                          {pinnedVisibleRows.map((row) => {
                            const index = orderedFilteredRows.findIndex((item) => item.id === row.id);
                            return (
                              <tr
                                key={row.id}
                                ref={(element) => {
                                  if (element) pinnedGridRowRefs.current.set(row.id, element);
                                  else pinnedGridRowRefs.current.delete(row.id);
                                }}
                                className={`grid-row-pinned ${!row.selected ? "muted" : ""}`}
                              >
                                <td className="sticky-select grid-row-pinned-cell" style={{ top: pinnedGridRowOffsets[row.id] ?? gridHeaderHeight }}>
                                  <input
                                    type="checkbox"
                                    aria-label={`Chọn ${row.compoundName}`}
                                    checked={row.selected}
                                    onChange={(event) => {
                                      setGridSelection(null);
                                      update(row.id, { selected: event.target.checked });
                                    }}
                                  />
                                </td>
                                {visibleGridColumnKeys.map((key, columnIndex) => <Fragment key={key}>{renderGridDataCell(row, index, key, columnIndex, true)}</Fragment>)}
                              </tr>
                            );
                          })}
                        </tbody>
                      )}
                      <tbody>
                        {scrollingVisibleRows.map((row) => {
                          const index = orderedFilteredRows.findIndex((item) => item.id === row.id);
                          return (
                            <tr key={row.id} className={!row.selected ? "muted" : ""}>
                              <td className="sticky-select">
                                <input
                                  type="checkbox"
                                  aria-label={`Chọn ${row.compoundName}`}
                                  checked={row.selected}
                                  onChange={(event) => {
                                    setGridSelection(null);
                                    update(row.id, { selected: event.target.checked });
                                  }}
                                />
                              </td>
                              {visibleGridColumnKeys.map((key, columnIndex) => <Fragment key={key}>{renderGridDataCell(row, index, key, columnIndex, false)}</Fragment>)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="empty">
                        Không có kết quả phù hợp bộ lọc.
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      <b>{selectedCount}</b>/{result.rows.length} dòng được chọn
                    </span>
                    <span>
                      {result.source === "gnps-task"
                        ? "GNPS2 Library #Scan# · tR lấy từ "
                        : "Đối chiếu tên hợp chất · tR lấy từ "}
                      <b>
                        {result.source === "gnps-task"
                          ? "Network GraphML.rt_min"
                          : "Excel.rt_min"}
                      </b>
                    </span>
                  </div>
                </div>
                {viewerTarget && (
                  <motion.aside
                    className="result-file-viewer"
                    initial={{ opacity: 0, x: 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <FileViewer
                      key={viewerTarget}
                      initialActive={viewerTarget}
                      files={{ tsv, xlsx }}
                      previews={previews}
                      onSheet={(sheet) =>
                        xlsx && void loadPreview(xlsx, "xlsx", sheet)
                      }
                      onClose={() => setViewerTarget(null)}
                    />
                  </motion.aside>
                )}
                {gnpsViewerOpen && compareUrl && (
                  <motion.aside
                    className="result-file-viewer gnps-web-viewer"
                    initial={{ opacity: 0, x: 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <section
                      className="gnps-web-panel"
                      aria-label="Đối chiếu dữ liệu trên GNPS"
                    >
                      <header>
                        <div>
                          <small>ĐỐI CHIẾU TRỰC TIẾP</small>
                          <strong>GNPS2 Library Matches</strong>
                          <span title={compareUrl}>{compareUrl}</span>
                        </div>
                        <div className="gnps-web-actions">
                          <button
                            type="button"
                            title="Sao chép liên kết"
                            aria-label="Sao chép liên kết GNPS"
                            onClick={() =>
                              void navigator.clipboard?.writeText(compareUrl)
                            }
                          >
                            {icons.copy}
                          </button>
                          <button
                            type="button"
                            title="Tải lại"
                            aria-label="Tải lại trang GNPS"
                            onClick={() =>
                              setGnpsFrameVersion((value) => value + 1)
                            }
                          >
                            {icons.refresh}
                          </button>
                          <a
                            href={compareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Mở trong tab mới"
                            aria-label="Mở GNPS trong tab mới"
                          >
                            {icons.external}
                          </a>
                          <button
                            type="button"
                            title="Đóng"
                            aria-label="Đóng ngăn GNPS"
                            onClick={() => setGnpsViewerOpen(false)}
                          >
                            {icons.close}
                          </button>
                        </div>
                      </header>
                      <div className="gnps-frame-wrap">
                        <iframe
                          key={gnpsFrameVersion}
                          src={compareUrl}
                          title="GNPS2 Library Matches"
                          referrerPolicy="no-referrer"
                          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
                        />
                        <div className="gnps-frame-help">
                          <span>Nếu GNPS không cho phép nhúng trang này,</span>
                          <a
                            href={compareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            mở GNPS trong tab mới {icons.external}
                          </a>
                        </div>
                      </div>
                    </section>
                  </motion.aside>
                )}
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {mappingOpen && mapping && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal mapping-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Ánh xạ cột dữ liệu"
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
            >
              <div className="modal-head">
                <span>{icons.tune}</span>
                <div>
                  <h2>Ánh xạ cột dữ liệu</h2>
                  <p>Chọn cột tương ứng. Các trường có dấu * là bắt buộc.</p>
                </div>
              </div>
              <div className="mapping-grid">
                {(Object.keys(mappingLabels) as (keyof ColumnMapping)[]).map(
                  (key) => {
                    const isExcel =
                      key === "excelCompoundName" || key === "excelRt";
                    return (
                      <label key={key}>
                        <span>{mappingLabels[key]}</span>
                        <select
                          value={mapping[key]}
                          onChange={(e) =>
                            setMapping({ ...mapping, [key]: e.target.value })
                          }
                        >
                          <option value="">— Không sử dụng —</option>
                          {(isExcel ? headers.excel : headers.tsv).map(
                            (header) => (
                              <option key={header}>{header}</option>
                            ),
                          )}
                        </select>
                      </label>
                    );
                  },
                )}
              </div>
              <div className="modal-actions">
                <button onClick={() => setMappingOpen(false)}>Hủy</button>
                <button
                  className="primary"
                  disabled={
                    !mapping.compoundName ||
                    !mapping.precursorMz ||
                    !mapping.excelCompoundName ||
                    !mapping.excelRt ||
                    loading
                  }
                  onClick={() => analyze(mapping)}
                >
                  {loading ? "Đang xử lý…" : "Áp dụng & đối chiếu"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {detailRow && (
          <motion.div
            className="modal-backdrop compound-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => {
              setDetailRow(null);
              setEditingCompoundId(null);
            }}
          >
            <motion.div
              className="compound-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="compound-dialog-title"
              initial={{ opacity: 0, scale: 0.95, y: 22 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="dialog-close"
                type="button"
                onClick={() => {
                  setDetailRow(null);
                  setEditingCompoundId(null);
                }}
                aria-label="Đóng"
              >
                {icons.close}
              </button>
              <div className="compound-dialog-image">
                {detailRow.structureData ? (
                  <img
                    src={detailRow.structureData}
                    alt={`Cấu trúc ${detailRow.compoundName}`}
                  />
                ) : (
                  <span>Không có ảnh cấu trúc</span>
                )}
              </div>
              <div className="compound-dialog-content">
                <small className="dialog-form-title-en">COMPOUND INFORMATION</small>
                <small className="dialog-form-title-vn">THÔNG TIN HỢP CHẤT · CHỈ ĐỌC</small>
                <div className="dialog-name">
                  <span className="dialog-label-pair"><b>Compound name</b><small>Tên hoạt chất</small></span>
                  {editingCompoundId === detailRow.id ? (
                    <div className="dialog-name-editor">
                      <input
                        id="compound-dialog-title"
                        autoFocus
                        value={compoundDraft}
                        onChange={(event) => setCompoundDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveCompoundName(detailRow.id);
                          } else if (event.key === "Escape") {
                            setEditingCompoundId(null);
                          }
                        }}
                      />
                      <button type="button" className="dialog-edit-save" onClick={() => saveCompoundName(detailRow.id)}>Lưu</button>
                      <button type="button" className="dialog-edit-cancel" onClick={() => setEditingCompoundId(null)}>Hủy</button>
                    </div>
                  ) : (
                    <div className="dialog-name-value">
                      <strong id="compound-dialog-title">{detailRow.compoundName || "—"}</strong>
                      <button
                        type="button"
                        onClick={() => {
                          setGridSelection(null);
                          setCompoundDraft(detailRow.compoundName);
                          setEditingCompoundId(detailRow.id);
                        }}
                      >Sửa tên</button>
                    </div>
                  )}
                </div>
                <div className="dialog-fields">
                  <div className="dialog-readonly-field">
                    <span><b>Retention time</b><small>Thời gian lưu · tR (min)</small></span>
                    <strong>{detailRow.rtDisplay || "—"}</strong>
                  </div>
                  <div className="dialog-readonly-field">
                    <span><b>Ion / adduct</b><small>Ion / chất cộng</small></span>
                    <strong>{detailRow.adduct || "—"}</strong>
                  </div>
                  <div className="dialog-readonly-field">
                    <span><b>Precursor m/z</b><small>Ion tiền chất</small></span>
                    <strong>{detailRow.mzTsv ?? "—"}</strong>
                  </div>
                  <div className="dialog-readonly-field">
                    <span><b>Molecular formula</b><small>Công thức phân tử</small></span>
                    <strong>{detailRow.molecularFormula || "—"}</strong>
                  </div>
                  <div className="dialog-readonly-field">
                    <span><b>MZ error (ppm)</b><small>Sai số MZ</small></span>
                    <strong>{detailRow.reportedMzErrorPpm ?? "—"}</strong>
                  </div>
                  <div className="dialog-readonly-field dialog-fragments">
                    <span><b>Fragments (m/z)</b><small>Mảnh vỡ</small></span>
                    <strong>{detailRow.fragments || "—"}</strong>
                  </div>
                </div>
                <div className="dialog-save-note">
                  {icons.check}
                  <span>Chỉ tên hợp chất có thể chỉnh sửa; thay đổi được tự lưu</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {loadingMode && (
          <motion.div
            className="loading-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="loading-panel"
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, y: -10 }}
            >
              <div className="loading-orbit">
                <i />
                <i />
                <i />
                <span>{icons.flask}</span>
              </div>
              <div className="loading-copy">
                <small>GNPS2 DATA PIPELINE</small>
                <h2>
                  {loadingMode === "task"
                    ? "Đang đồng bộ dữ liệu GNPS2"
                    : "Đang đối chiếu dữ liệu"}
                </h2>
                <p>
                  Vui lòng giữ cửa sổ này mở. Hệ thống sẽ tự chuyển sang danh
                  sách khi hoàn tất.
                </p>
              </div>
              <div
                className={`loading-progress ${loadingProgress?.outcome ?? "working"}`}
                role="status"
                aria-live="polite"
              >
                <span className="loading-progress-icon" aria-hidden="true">
                  {loadingProgress?.outcome === "success" ? icons.check : <i />}
                </span>
                <div className="loading-progress-copy">
                  <div className="loading-progress-heading">
                    <strong>
                      {loadingProgress?.title ??
                        (loadingMode === "task"
                          ? "Đang chờ tiến trình GNPS2"
                          : "Đang xử lý file TSV/XLSX và lưu báo cáo")}
                    </strong>
                    <span>
                      {loadingProgress
                        ? `Bước ${loadingProgress.step}/${loadingProgress.totalSteps} · ${loadingProgress.percent}%`
                        : "Đang xử lý"}
                    </span>
                  </div>
                  <p>
                    {loadingProgress?.message ??
                      (loadingMode === "task"
                        ? "Đang kết nối máy chủ để bắt đầu đọc task."
                        : "Đang tải lên, đối chiếu dữ liệu và lưu báo cáo.")}
                  </p>
                  {(loadingProgress?.detail ||
                    loadingProgress?.current !== undefined) && (
                    <small>
                      {loadingProgress.detail ??
                        `${loadingProgress.current}/${loadingProgress.total ?? 0} mục`}
                      {loadingProgress.succeeded !== undefined &&
                        ` · ${loadingProgress.succeeded} thành công`}
                      {loadingProgress.failed !== undefined &&
                        ` · ${loadingProgress.failed} lỗi`}
                    </small>
                  )}
                  {loadingMode === "task" && (
                    <div
                      className="loading-progress-track"
                      role="progressbar"
                      aria-label="Tiến trình nhập dữ liệu GNPS2"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={loadingProgress?.percent ?? 0}
                    >
                      <span style={{ width: `${loadingProgress?.percent ?? 0}%` }} />
                    </div>
                  )}
                </div>
              </div>
              <div className="loading-bar">
                <b />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </WorkspaceShell>
  );
}
