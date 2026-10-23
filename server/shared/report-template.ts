// Custom Word templates: the editor stores a TipTap/ProseMirror JSON document.
// This module is shared by the server (DOCX export) and the browser (preview),
// so it must stay dependency-free.

export type FieldScope = "report" | "row";
export type FieldKind = "text" | "number" | "formula" | "image" | "block";
export interface FieldDef {
  key: string;
  label: string;
  group: string;
  scope: FieldScope;
  kind: FieldKind;
  decimals?: number;
}
export const TEMPLATE_FIELDS: FieldDef[] = [
  {
    key: "report.title",
    label: "Tiêu đề báo cáo",
    group: "Báo cáo",
    scope: "report",
    kind: "text",
  },
  {
    key: "report.exportDate",
    label: "Ngày xuất",
    group: "Báo cáo",
    scope: "report",
    kind: "text",
  },
  {
    key: "report.source",
    label: "Nguồn dữ liệu",
    group: "Báo cáo",
    scope: "report",
    kind: "text",
  },
  {
    key: "report.task",
    label: "Task GNPS2",
    group: "Báo cáo",
    scope: "report",
    kind: "text",
  },
  {
    key: "report.mzMode",
    label: "Chế độ sai số m/z",
    group: "Báo cáo",
    scope: "report",
    kind: "text",
  },
  {
    key: "report.mzTolerance",
    label: "Dung sai m/z",
    group: "Báo cáo",
    scope: "report",
    kind: "number",
    decimals: 3,
  },
  {
    key: "report.rtTolerance",
    label: "Dung sai RT",
    group: "Báo cáo",
    scope: "report",
    kind: "number",
    decimals: 3,
  },
  {
    key: "summary.tsvRows",
    label: "Số dòng TSV",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "summary.dataRows",
    label: "Số dòng dữ liệu",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "summary.matched",
    label: "Số dòng đã khớp",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "summary.unmatched",
    label: "Số dòng chưa khớp",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "summary.exportedRows",
    label: "Số dòng xuất (đã chọn)",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "summary.structures",
    label: "Số dòng có cấu trúc",
    group: "Tổng hợp",
    scope: "report",
    kind: "number",
    decimals: 0,
  },
  {
    key: "ai.discussion",
    label: "Nháp Kết quả và thảo luận",
    group: "AI",
    scope: "report",
    kind: "block",
  },
  {
    key: "row.index",
    label: "STT",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 0,
  },
  {
    key: "row.compoundName",
    label: "Tên hoạt chất",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.adduct",
    label: "Ion (adduct)",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.mzTsv",
    label: "m/z precursor",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 5,
  },
  {
    key: "row.mzData",
    label: "m/z dữ liệu",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 5,
  },
  {
    key: "row.rt",
    label: "RT",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 3,
  },
  {
    key: "row.ppm",
    label: "Sai số ppm",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 5,
  },
  {
    key: "row.deltaDa",
    label: "Sai số Da",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 5,
  },
  {
    key: "row.deltaRt",
    label: "Lệch RT",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 3,
  },
  {
    key: "row.formula",
    label: "Công thức phân tử",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "formula",
  },
  {
    key: "row.fragments",
    label: "m/z fragments",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.status",
    label: "Trạng thái khớp",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.candidateCount",
    label: "Số ứng viên",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "number",
    decimals: 0,
  },
  {
    key: "row.structure",
    label: "Ảnh cấu trúc",
    group: "Dòng dữ liệu",
    scope: "row",
    kind: "image",
  },
  {
    key: "row.spectrumId",
    label: "SpectrumID thư viện",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.mqScore",
    label: "MQScore",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "number",
    decimals: 3,
  },
  {
    key: "row.sharedPeaks",
    label: "SharedPeaks",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "number",
    decimals: 0,
  },
  {
    key: "row.smiles",
    label: "SMILES",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.inchikey",
    label: "InChIKey",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.npPathway",
    label: "NPClassifier pathway",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.npSuperclass",
    label: "NPClassifier superclass",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
  {
    key: "row.npClass",
    label: "NPClassifier class",
    group: "Thư viện GNPS",
    scope: "row",
    kind: "text",
  },
];
export const FIELD_BY_KEY = new Map(TEMPLATE_FIELDS.map((f) => [f.key, f]));

export interface TemplateRow {
  [key: string]: any;
}
export interface TemplateReport {
  title: string;
  sourceUrl?: string | null;
  task?: string | null;
  exportedAt: string;
  parameters?: { mzMode?: string; mzTolerance?: number; rtTolerance?: number };
  summary?: Record<string, number | undefined>;
  rows: TemplateRow[];
  discussion?: string | null;
}
export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "formula"; text: string }
  | { kind: "image"; dataUrl: string | null }
  | { kind: "block"; markdown: string };

const STATUS: Record<string, string> = {
  matched: "Đã khớp",
  ambiguous: "Chưa chắc chắn",
  unmatched: "Chưa khớp",
};
// Same Vietnamese number style as the default Word export.
export function formatNumber(value: unknown, decimals: number) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("vi-VN", { maximumFractionDigits: decimals })
    : "";
}
function meta(row: TemplateRow, ...keys: string[]) {
  const wanted = new Set(
    keys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  for (const [k, v] of Object.entries(row.sourceMetadata ?? {}))
    if (
      wanted.has(k.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
      v !== null &&
      String(v).trim()
    )
      return v as string | number;
  return null;
}
function rawValue(
  key: string,
  report: TemplateReport,
  row?: TemplateRow,
  index = 0,
): unknown {
  const p = report.parameters ?? {},
    s = report.summary ?? {};
  switch (key) {
    case "report.title":
      return report.title;
    case "report.exportDate":
      return new Date(report.exportedAt).toLocaleDateString("vi-VN");
    case "report.source":
      return report.sourceUrl ?? "Tệp TSV và Excel tải lên";
    case "report.task":
      return report.task ?? "";
    case "report.mzMode":
      return p.mzMode === "da" ? "Da" : "ppm";
    case "report.mzTolerance":
      return p.mzTolerance;
    case "report.rtTolerance":
      return p.rtTolerance;
    case "summary.tsvRows":
      return s.tsvRows;
    case "summary.dataRows":
      return s.dataRows;
    case "summary.matched":
      return report.rows.filter((r) => r.status === "matched").length;
    case "summary.unmatched":
      return report.rows.filter((r) => r.status === "unmatched").length;
    case "summary.exportedRows":
      return report.rows.filter((r) => r.selected !== false).length;
    case "summary.structures":
      return report.rows.filter((r) => r.structureData).length;
  }
  if (!row) return "";
  switch (key) {
    case "row.index":
      return index + 1;
    case "row.compoundName":
      return row.compoundName;
    case "row.adduct":
      return row.adduct;
    case "row.mzTsv":
      return row.mzTsv;
    case "row.mzData":
      return row.mzData;
    case "row.rt":
      return row.rtTsv ?? row.rtData;
    case "row.ppm":
      return row.reportedMzErrorPpm ?? row.deltaPpm;
    case "row.deltaDa":
      return row.deltaDa;
    case "row.deltaRt":
      return row.deltaRt;
    case "row.formula":
      return row.molecularFormula;
    case "row.fragments":
      return row.fragments;
    case "row.status":
      return STATUS[row.status] ?? row.status;
    case "row.candidateCount":
      return row.candidateCount;
    case "row.spectrumId":
      return meta(row, "SpectrumID");
    case "row.mqScore":
      return meta(row, "MQScore");
    case "row.sharedPeaks":
      return meta(row, "SharedPeaks");
    case "row.smiles":
      return meta(row, "Smiles");
    case "row.inchikey":
      return meta(row, "InChIKey");
    case "row.npPathway":
      return meta(row, "npclassifier_pathway");
    case "row.npSuperclass":
      return meta(row, "npclassifier_superclass");
    case "row.npClass":
      return meta(row, "npclassifier_class");
  }
  return "";
}
// Value of a field for the report, or for one repeated row (row fields are
// empty outside a repeat row).
export function fieldValue(
  key: string,
  report: TemplateReport,
  row?: TemplateRow,
  index = 0,
  decimals?: number | null,
): FieldValue {
  const def = FIELD_BY_KEY.get(key);
  if (!def) return { kind: "text", text: "" };
  if (def.kind === "block")
    return { kind: "block", markdown: report.discussion ?? "" };
  if (def.kind === "image") {
    const data = row?.structureData;
    return {
      kind: "image",
      // Exports carry data URIs; the in-app preview gets the stored asset URL.
      dataUrl:
        typeof data === "string" &&
        (/^data:image\/(png|jpe?g);base64,/i.test(data) ||
          /^\/api\/reports\/[^?#]+\/download$/.test(data))
          ? data
          : null,
    };
  }
  const value = rawValue(key, report, row, index);
  if (def.kind === "formula")
    return { kind: "formula", text: String(value ?? "").trim() };
  if (def.kind === "number") {
    // RT keeps the report's own display text when present, like the default export.
    if (key === "row.rt" && row?.rtDisplay)
      return { kind: "text", text: String(row.rtDisplay).replace(".", ",") };
    return {
      kind: "text",
      text: formatNumber(value, decimals ?? def.decimals ?? 3),
    };
  }
  return {
    kind: "text",
    text: value === null || value === undefined ? "" : String(value),
  };
}

export interface RepeatSpec {
  filter: "selected" | "all" | "matched" | "ambiguous" | "unmatched";
  sort: "report" | "abs_ppm_desc";
}
export const DEFAULT_REPEAT: RepeatSpec = {
  filter: "selected",
  sort: "report",
};
export function repeatRows(
  rows: TemplateRow[],
  spec: RepeatSpec | null | undefined,
) {
  const s = { ...DEFAULT_REPEAT, ...(spec ?? {}) };
  const out = rows.filter((r) =>
    s.filter === "all"
      ? true
      : s.filter === "selected"
        ? r.selected !== false
        : r.status === s.filter,
  );
  if (s.sort === "abs_ppm_desc") {
    const ppm = (r: TemplateRow) => {
      const v = Number(r.reportedMzErrorPpm ?? r.deltaPpm);
      return Number.isFinite(v) ? Math.abs(v) : -1;
    };
    out.sort((a, b) => ppm(b) - ppm(a));
  }
  return out;
}

export interface PageSettings {
  orientation: "portrait" | "landscape";
  // millimetres
  margins: { top: number; right: number; bottom: number; left: number };
}
export const DEFAULT_PAGE: PageSettings = {
  orientation: "landscape",
  margins: { top: 20, right: 15, bottom: 20, left: 20 },
};

// ---- validation ------------------------------------------------------------
export interface TemplateNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TemplateNode[];
  text?: string;
  marks?: { type: string }[];
}
const ALIGN = new Set(["left", "center", "right", "justify"]);
const MARKS = new Set(["bold", "italic", "underline", "strike"]);
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "table",
  "pageBreak",
]);
const CHILDREN: Record<string, Set<string>> = {
  doc: BLOCKS,
  paragraph: new Set(["text", "hardBreak", "field"]),
  heading: new Set(["text", "hardBreak", "field"]),
  bulletList: new Set(["listItem"]),
  orderedList: new Set(["listItem"]),
  listItem: new Set(["paragraph", "bulletList", "orderedList"]),
  table: new Set(["tableRow"]),
  tableRow: new Set(["tableCell", "tableHeader"]),
  tableCell: new Set(["paragraph", "bulletList", "orderedList"]),
  tableHeader: new Set(["paragraph", "bulletList", "orderedList"]),
};
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
// Rebuilds the document keeping only known nodes, marks and attributes, so
// the server never renders arbitrary editor output.
export function sanitizeTemplate(input: unknown): TemplateNode {
  let count = 0;
  const walk = (
    node: any,
    parent: string,
    depth: number,
  ): TemplateNode | null => {
    if (!node || typeof node !== "object" || depth > 40 || ++count > 50000)
      throw new Error("Mẫu quá lớn hoặc lồng quá sâu.");
    const type = String(node.type);
    if (!CHILDREN[parent]?.has(type)) return null;
    if (type === "text") {
      const text =
        typeof node.text === "string" ? node.text.slice(0, 20000) : "";
      if (!text) return null;
      const marks = Array.isArray(node.marks)
        ? node.marks
            .filter((m: any) => MARKS.has(m?.type))
            .map((m: any) => ({ type: m.type }))
        : [];
      return marks.length ? { type, text, marks } : { type, text };
    }
    if (type === "hardBreak" || type === "pageBreak") return { type };
    if (type === "field") {
      const key = String(node.attrs?.key ?? "");
      if (!FIELD_BY_KEY.has(key)) return null;
      const decimals = node.attrs?.decimals;
      return {
        type,
        attrs: {
          key,
          decimals:
            decimals === null || decimals === undefined || decimals === ""
              ? null
              : int(decimals, 0, 8, 3),
        },
      };
    }
    const attrs: Record<string, any> = {};
    if (type === "paragraph" || type === "heading")
      attrs.textAlign = ALIGN.has(node.attrs?.textAlign)
        ? node.attrs.textAlign
        : null;
    if (type === "heading") attrs.level = int(node.attrs?.level, 1, 3, 1);
    if (type === "orderedList")
      attrs.start = int(node.attrs?.start, 1, 10000, 1);
    if (type === "tableCell" || type === "tableHeader") {
      attrs.colspan = int(node.attrs?.colspan, 1, 50, 1);
      attrs.rowspan = int(node.attrs?.rowspan, 1, 500, 1);
      attrs.colwidth = Array.isArray(node.attrs?.colwidth)
        ? node.attrs.colwidth.map((w: unknown) => int(w, 10, 2000, 100))
        : null;
    }
    if (type === "tableRow") {
      const r = node.attrs?.repeat;
      attrs.repeat =
        r && typeof r === "object"
          ? {
              filter: [
                "selected",
                "all",
                "matched",
                "ambiguous",
                "unmatched",
              ].includes(r.filter)
                ? r.filter
                : "selected",
              sort: r.sort === "abs_ppm_desc" ? "abs_ppm_desc" : "report",
            }
          : null;
    }
    const content = Array.isArray(node.content)
      ? (node.content
          .map((c: unknown) => walk(c, type, depth + 1))
          .filter(Boolean) as TemplateNode[])
      : [];
    // Containers that ProseMirror requires to be non-empty get an empty paragraph.
    if (
      ["tableCell", "tableHeader", "listItem"].includes(type) &&
      !content.length
    )
      content.push({ type: "paragraph", attrs: { textAlign: null } });
    if (
      ["table", "tableRow", "bulletList", "orderedList"].includes(type) &&
      !content.length
    )
      return null;
    return Object.keys(attrs).length || content.length
      ? {
          type,
          ...(Object.keys(attrs).length ? { attrs } : {}),
          ...(content.length ? { content } : {}),
        }
      : { type };
  };
  const doc = input as any;
  if (!doc || doc.type !== "doc") throw new Error("Nội dung mẫu không hợp lệ.");
  const content = (Array.isArray(doc.content) ? doc.content : [])
    .map((c: unknown) => walk(c, "doc", 1))
    .filter(Boolean) as TemplateNode[];
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}
export function sanitizePage(input: any): PageSettings {
  const mm = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 5 && n <= 60 ? Math.round(n) : fallback;
  };
  return {
    orientation: input?.orientation === "portrait" ? "portrait" : "landscape",
    margins: {
      top: mm(input?.margins?.top, DEFAULT_PAGE.margins.top),
      right: mm(input?.margins?.right, DEFAULT_PAGE.margins.right),
      bottom: mm(input?.margins?.bottom, DEFAULT_PAGE.margins.bottom),
      left: mm(input?.margins?.left, DEFAULT_PAGE.margins.left),
    },
  };
}

// ---- starter templates -----------------------------------------------------
const f = (key: string, decimals?: number): TemplateNode => ({
  type: "field",
  attrs: { key, decimals: decimals ?? null },
});
const p = (
  content: TemplateNode[],
  textAlign: string | null = null,
): TemplateNode => ({
  type: "paragraph",
  attrs: { textAlign },
  content,
});
const t = (text: string, bold = false): TemplateNode =>
  bold
    ? { type: "text", text, marks: [{ type: "bold" }] }
    : { type: "text", text };
const cell = (content: TemplateNode[], header = false): TemplateNode => ({
  type: header ? "tableHeader" : "tableCell",
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [p(content, "center")],
});
// Mirrors the default export: title, the selected rows table with structures.
export function basicTemplate(): TemplateNode {
  const columns: [string, string][] = [
    ["STT", "row.index"],
    ["RT (phút)", "row.rt"],
    ["Tên hoạt chất", "row.compoundName"],
    ["Ion", "row.adduct"],
    ["m/z precursor", "row.mzTsv"],
    ["m/z fragments", "row.fragments"],
    ["Công thức", "row.formula"],
    ["Sai số (ppm)", "row.ppm"],
    ["Cấu trúc", "row.structure"],
  ];
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, textAlign: "center" },
        content: [f("report.title")],
      },
      p(
        [
          t("Nguồn: "),
          f("report.source"),
          t(" · Ngày xuất: "),
          f("report.exportDate"),
        ],
        "center",
      ),
      p([
        t("Đối sánh với dung sai m/z "),
        f("report.mzTolerance"),
        t(" "),
        f("report.mzMode"),
        t(", dung sai RT "),
        f("report.rtTolerance"),
        t(" phút. Số hợp chất xuất: "),
        f("summary.exportedRows"),
        t("."),
      ]),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            attrs: { repeat: null },
            content: columns.map(([label]) => cell([t(label, true)], true)),
          },
          {
            type: "tableRow",
            attrs: { repeat: { ...DEFAULT_REPEAT } },
            content: columns.map(([, key]) => cell([f(key)])),
          },
        ],
      },
    ],
  };
}
export function blankTemplate(): TemplateNode {
  return { type: "doc", content: [p([])] };
}
