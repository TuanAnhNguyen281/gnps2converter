import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import {
  fieldValue,
  repeatRows,
  type PageSettings,
  type TemplateNode,
  type TemplateReport,
  type TemplateRow,
} from "../shared/report-template.js";

// Renders a sanitized template document to DOCX with the `docx` library.
// Text always goes through TextRun, so template content cannot inject XML.

const ALIGN: Record<
  string,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const HEADING = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
];
const MM = 56.7; // twips per millimetre
interface Ctx {
  report: TemplateReport;
  row?: TemplateRow;
  index: number;
  // A fresh numbering instance per ordered list, so each restarts at 1.
  lists: { next: number };
}
interface ListLevel {
  reference: "bullets" | "ordered";
  level: number;
  instance: number;
}

function pngSize(data: Buffer) {
  return data.length > 24 && data.readUInt32BE(0) === 0x89504e47
    ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    : null;
}
function imageRun(dataUrl: string) {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return null;
  const data = Buffer.from(m[2], "base64"),
    size = pngSize(data) ?? { width: 4, height: 3 },
    // Fit into a 120×90 px box, the cell size of the default template.
    scale = Math.min(120 / size.width, 90 / size.height, 1);
  return new ImageRun({
    type: m[1].toLowerCase() === "png" ? "png" : "jpg",
    data,
    transformation: {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    },
  });
}
function markOptions(node: TemplateNode) {
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  return {
    bold: marks.has("bold") || undefined,
    italics: marks.has("italic") || undefined,
    underline: marks.has("underline") ? {} : undefined,
    strike: marks.has("strike") || undefined,
  };
}
function inlineRuns(
  nodes: TemplateNode[] = [],
  ctx: Ctx,
  bold = false,
): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === "text")
      runs.push(
        new TextRun({
          text: node.text ?? "",
          ...markOptions(node),
          ...(bold ? { bold: true } : {}),
        }),
      );
    else if (node.type === "hardBreak") runs.push(new TextRun({ break: 1 }));
    else if (node.type === "field") {
      const value = fieldValue(
        node.attrs?.key,
        ctx.report,
        ctx.row,
        ctx.index,
        node.attrs?.decimals,
      );
      if (value.kind === "text")
        runs.push(new TextRun({ text: value.text, bold: bold || undefined }));
      else if (value.kind === "formula")
        // Digits as native Word subscripts, like the default export.
        for (const part of value.text.split(/(\d+)/).filter(Boolean))
          runs.push(
            new TextRun({
              text: part,
              subScript: /^\d+$/.test(part) || undefined,
              bold: bold || undefined,
            }),
          );
      else if (value.kind === "image") {
        const image = value.dataUrl ? imageRun(value.dataUrl) : null;
        if (image) runs.push(image);
      } else
        runs.push(
          new TextRun({ text: value.markdown.replace(/\s+/g, " ").trim() }),
        );
    }
  }
  return runs;
}
// A paragraph holding only the discussion field becomes the draft's paragraphs.
function markdownParagraphs(markdown: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line)) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line),
      item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line),
      clean = (s: string) =>
        s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    if (heading)
      out.push(
        new Paragraph({
          children: [new TextRun({ text: clean(heading[1]), bold: true })],
        }),
      );
    else if (item)
      out.push(
        new Paragraph({
          children: [new TextRun(`• ${clean(item[1])}`)],
          indent: { left: 360, hanging: 240 },
        }),
      );
    else if (line.startsWith("|"))
      out.push(
        new Paragraph({
          children: [
            new TextRun(
              clean(
                line
                  .replace(/^\||\|$/g, "")
                  .split("|")
                  .map((c) => c.trim())
                  .join(" · "),
              ),
            ),
          ],
        }),
      );
    else
      out.push(
        new Paragraph({
          children: [new TextRun(clean(line.replace(/^>\s?/, "")))],
        }),
      );
  }
  return out;
}
function blocks(
  nodes: TemplateNode[] = [],
  ctx: Ctx,
  list?: ListLevel,
  header = false,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes) {
    if (node.type === "paragraph" || node.type === "heading") {
      const only =
        node.content?.length === 1 && node.content[0].type === "field"
          ? node.content[0]
          : null;
      if (only?.attrs?.key === "ai.discussion" && !list) {
        out.push(...markdownParagraphs(ctx.report.discussion ?? ""));
        continue;
      }
      out.push(
        new Paragraph({
          children: inlineRuns(node.content, ctx, header),
          alignment: ALIGN[node.attrs?.textAlign ?? ""],
          heading:
            node.type === "heading"
              ? HEADING[(node.attrs?.level ?? 1) - 1]
              : undefined,
          numbering: list,
        }),
      );
    } else if (node.type === "pageBreak")
      out.push(new Paragraph({ children: [new PageBreak()] }));
    else if (node.type === "bulletList" || node.type === "orderedList") {
      const reference = node.type === "bulletList" ? "bullets" : "ordered",
        level = list ? Math.min(list.level + 1, 8) : 0,
        instance = reference === "ordered" ? ++ctx.lists.next : 0;
      for (const item of node.content ?? [])
        out.push(
          ...blocks(item.content, ctx, { reference, level, instance }, header),
        );
    } else if (node.type === "table") out.push(table(node, ctx));
  }
  return out;
}
function cells(row: TemplateNode, ctx: Ctx) {
  return (row.content ?? []).map((cell) => {
    const header = cell.type === "tableHeader",
      width = cell.attrs?.colwidth?.[0],
      colspan = Number(cell.attrs?.colspan ?? 1),
      rowspan = Number(cell.attrs?.rowspan ?? 1);
    const children = blocks(cell.content, ctx, undefined, header).filter(
      (b): b is Paragraph => b instanceof Paragraph,
    );
    return new TableCell({
      children: children.length ? children : [new Paragraph("")],
      columnSpan: colspan > 1 ? colspan : undefined,
      rowSpan: rowspan > 1 ? rowspan : undefined,
      width: width
        ? { size: Math.round(width * 15), type: WidthType.DXA }
        : undefined,
      shading: header
        ? { fill: "D9EEF2", type: ShadingType.CLEAR, color: "auto" }
        : undefined,
    });
  });
}
function table(node: TemplateNode, ctx: Ctx) {
  const rows: TableRow[] = [];
  for (const row of node.content ?? []) {
    const allHeader = (row.content ?? []).every(
      (c) => c.type === "tableHeader",
    );
    if (row.attrs?.repeat) {
      // One copy of the row per data row; STT counts within this table.
      repeatRows(ctx.report.rows, row.attrs.repeat).forEach((data, index) =>
        rows.push(
          new TableRow({
            children: cells(row, { ...ctx, row: data, index }),
            cantSplit: true,
          }),
        ),
      );
    } else
      rows.push(
        new TableRow({
          children: cells(row, ctx),
          tableHeader: allHeader || undefined,
        }),
      );
  }
  if (!rows.length)
    rows.push(
      new TableRow({
        children: [new TableCell({ children: [new Paragraph("")] })],
      }),
    );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}
export async function renderTemplateDocx(
  doc: TemplateNode,
  page: PageSettings,
  report: TemplateReport,
) {
  const ctx: Ctx = { report, index: 0, lists: { next: 0 } };
  const children = blocks(doc.content, ctx);
  const landscape = page.orientation === "landscape";
  const document = new Document({
    styles: {
      default: { document: { run: { font: "Times New Roman", size: 24 } } },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level % 3],
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } },
            },
          })),
        },
        {
          reference: "ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 300 } },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: landscape
                ? PageOrientation.LANDSCAPE
                : PageOrientation.PORTRAIT,
            },
            margin: {
              top: Math.round(page.margins.top * MM),
              right: Math.round(page.margins.right * MM),
              bottom: Math.round(page.margins.bottom * MM),
              left: Math.round(page.margins.left * MM),
            },
          },
        },
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  return Packer.toBuffer(document);
}
