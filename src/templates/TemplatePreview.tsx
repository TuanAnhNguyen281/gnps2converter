import type { CSSProperties, ReactNode } from "react";
import { apiUrl } from "../api";
import { Markdown } from "../ai/Markdown";
import {
  fieldValue,
  repeatRows,
  type PageSettings,
  type TemplateNode,
  type TemplateReport,
  type TemplateRow,
} from "../../server/shared/report-template";

// Mirrors server/templates/render.ts in HTML, using the same field resolver,
// so what is previewed is what the DOCX export contains.
const PREVIEW_ROWS = 50;
interface Ctx {
  report: TemplateReport;
  row?: TemplateRow;
  index: number;
}
function marks(node: TemplateNode, text: ReactNode) {
  let out = text;
  for (const m of node.marks ?? []) {
    if (m.type === "bold") out = <strong>{out}</strong>;
    if (m.type === "italic") out = <em>{out}</em>;
    if (m.type === "underline") out = <u>{out}</u>;
    if (m.type === "strike") out = <s>{out}</s>;
  }
  return out;
}
function inline(nodes: TemplateNode[] = [], ctx: Ctx): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === "text")
      return <span key={i}>{marks(node, node.text)}</span>;
    if (node.type === "hardBreak") return <br key={i} />;
    if (node.type !== "field") return null;
    const value = fieldValue(
      node.attrs?.key,
      ctx.report,
      ctx.row,
      ctx.index,
      node.attrs?.decimals,
    );
    if (value.kind === "text") return <span key={i}>{value.text}</span>;
    if (value.kind === "formula")
      return (
        <span key={i}>
          {value.text
            .split(/(\d+)/)
            .filter(Boolean)
            .map((part, j) =>
              /^\d+$/.test(part) ? <sub key={j}>{part}</sub> : part,
            )}
        </span>
      );
    if (value.kind === "image")
      return value.dataUrl ? (
        <img
          key={i}
          className="tpl-structure"
          alt="Cấu trúc"
          src={
            value.dataUrl.startsWith("/api/")
              ? apiUrl(value.dataUrl)
              : value.dataUrl
          }
        />
      ) : null;
    return <span key={i}>{value.markdown.replace(/\s+/g, " ")}</span>;
  });
}
function blocks(nodes: TemplateNode[] = [], ctx: Ctx): ReactNode[] {
  return nodes.map((node, i) => {
    const style: CSSProperties = {
      textAlign: node.attrs?.textAlign ?? undefined,
    };
    if (node.type === "paragraph" || node.type === "heading") {
      const only = node.content?.length === 1 ? node.content[0] : null;
      if (only?.type === "field" && only.attrs?.key === "ai.discussion")
        return (
          <div key={i} className="tpl-discussion">
            {ctx.report.discussion ? (
              <Markdown text={ctx.report.discussion} />
            ) : (
              <em>(Chưa có nháp “Kết quả và thảo luận” cho báo cáo này)</em>
            )}
          </div>
        );
      const Tag =
        node.type === "heading" ? (`h${node.attrs?.level ?? 1}` as "h1") : "p";
      return (
        <Tag key={i} style={style}>
          {inline(node.content, ctx)}
        </Tag>
      );
    }
    if (node.type === "pageBreak")
      return <hr key={i} className="tpl-page-break-preview" />;
    if (node.type === "bulletList" || node.type === "orderedList") {
      const List = node.type === "bulletList" ? "ul" : "ol";
      return (
        <List key={i}>
          {(node.content ?? []).map((item, j) => (
            <li key={j}>{blocks(item.content, ctx)}</li>
          ))}
        </List>
      );
    }
    if (node.type === "table") return table(node, ctx, i);
    return null;
  });
}
function cells(row: TemplateNode, ctx: Ctx) {
  return (row.content ?? []).map((cell, j) => {
    const Cell = cell.type === "tableHeader" ? "th" : "td";
    return (
      <Cell
        key={j}
        colSpan={cell.attrs?.colspan ?? 1}
        rowSpan={cell.attrs?.rowspan ?? 1}
        style={
          cell.attrs?.colwidth?.[0]
            ? { width: cell.attrs.colwidth[0] }
            : undefined
        }
      >
        {blocks(cell.content, ctx)}
      </Cell>
    );
  });
}
function table(node: TemplateNode, ctx: Ctx, key: number) {
  const rows: ReactNode[] = [];
  (node.content ?? []).forEach((row, r) => {
    if (!row.attrs?.repeat) {
      rows.push(<tr key={r}>{cells(row, ctx)}</tr>);
      return;
    }
    const data = repeatRows(ctx.report.rows, row.attrs.repeat);
    data.slice(0, PREVIEW_ROWS).forEach((item, index) =>
      rows.push(
        <tr key={`${r}-${index}`} className="tpl-repeat-preview">
          {cells(row, { ...ctx, row: item, index })}
        </tr>,
      ),
    );
    if (data.length > PREVIEW_ROWS)
      rows.push(
        <tr key={`${r}-more`}>
          <td colSpan={row.content?.length ?? 1} className="tpl-more">
            … còn {data.length - PREVIEW_ROWS} dòng nữa trong file xuất
          </td>
        </tr>,
      );
    if (!data.length)
      rows.push(
        <tr key={`${r}-none`}>
          <td colSpan={row.content?.length ?? 1} className="tpl-more">
            Không có dòng dữ liệu nào khớp bộ lọc của hàng lặp
          </td>
        </tr>,
      );
  });
  return (
    <table key={key}>
      <tbody>{rows}</tbody>
    </table>
  );
}
export function pageStyle(page: PageSettings): CSSProperties {
  return {
    width: page.orientation === "landscape" ? "297mm" : "210mm",
    minHeight: page.orientation === "landscape" ? "210mm" : "297mm",
    padding: `${page.margins.top}mm ${page.margins.right}mm ${page.margins.bottom}mm ${page.margins.left}mm`,
  };
}
export function TemplatePreview({
  doc,
  page,
  report,
  zoom = 1,
}: {
  doc: TemplateNode;
  page: PageSettings;
  report: TemplateReport;
  zoom?: number;
}) {
  return (
    <div className="tpl-page tpl-preview" style={{ ...pageStyle(page), zoom }}>
      {blocks(doc.content, { report, index: 0 })}
    </div>
  );
}
