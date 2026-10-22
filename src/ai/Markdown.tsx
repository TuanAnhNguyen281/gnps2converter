import type { ReactNode } from "react";
import type { Citation } from "./types";

// Minimal Markdown subset rendered as React elements (never as HTML), plus [R1-12] citation chips.
const inlinePattern =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[(?:R\d{1,3}(?:-\d{1,6})?(?:\s*[,;]\s*R\d{1,3}(?:-\d{1,6})?)*)\])|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(\*[^*\n]+\*|_[^_\n]+_)/g;

type Cite = (ref: string) => ReactNode;

function inline(text: string, cite: Cite, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0,
    n = 0;
  for (const m of text.matchAll(inlinePattern)) {
    const at = m.index ?? 0,
      k = `${key}.${n++}`;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    if (m[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (m[2])
      out.push(<strong key={k}>{inline(token.slice(2, -2), cite, k)}</strong>);
    else if (m[3])
      out.push(
        <span key={k} className="citation-group">
          {token
            .slice(1, -1)
            .split(/\s*[,;]\s*/)
            .map((ref, j) => (
              <span key={j}>{cite(ref)}</span>
            ))}
        </span>,
      );
    else if (m[4]) {
      const split = token.indexOf("](");
      out.push(
        <a
          key={k}
          href={token.slice(split + 2, -1)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {token.slice(1, split)}
        </a>,
      );
    } else out.push(<em key={k}>{inline(token.slice(1, -1), cite, k)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isTableRule = (line?: string) =>
  !!line && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const listItem = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;

export function Markdown({
  text,
  citations,
  onCite,
}: {
  text: string;
  citations?: Citation[] | null;
  onCite?: (citation: Citation) => void;
}) {
  const known = new Map((citations ?? []).map((c) => [c.ref, c]));
  const cite: Cite = (ref) => {
    const c = known.get(ref),
      status = c?.status ?? "pending",
      title =
        status === "ok"
          ? c?.rowId
            ? "Mở dòng trong báo cáo"
            : "Mở báo cáo"
          : status === "unseen"
            ? "Dòng có trong báo cáo nhưng AI chưa được xem dữ liệu này"
            : status === "invalid"
              ? "Mã nguồn không tồn tại trong snapshot"
              : "Đang kiểm tra nguồn";
    return (
      <button
        type="button"
        className={`citation ${status}`}
        title={title}
        disabled={!c?.reportId || !onCite}
        onClick={() => c && onCite?.(c)}
      >
        {ref}
        {status === "unseen" || status === "invalid" ? " ⚠" : ""}
      </button>
    );
  };
  const lines = text.replace(/\r\n?/g, "\n").split("\n"),
    blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i],
      k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]))
        body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(6, heading[1].length + 2)}` as "h3";
      blocks.push(<Tag key={k}>{inline(heading[2], cite, k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr key={k} />);
      i++;
      continue;
    }
    if (line.includes("|") && isTableRule(lines[i + 1])) {
      const head = cells(line),
        rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, cite, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j}>
                      {inline(r[j] ?? "", cite, `${k}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={k}>{inline(body.join(" "), cite, k)}</blockquote>,
      );
      continue;
    }
    const first = listItem.exec(line);
    if (first) {
      const ordered = Boolean(first[1]),
        items: string[] = [];
      while (i < lines.length) {
        const m = listItem.exec(lines[i]);
        if (m && Boolean(m[1]) === ordered) items.push(m[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length)
          items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k} start={ordered ? Number(first[1]) : undefined}>
          {items.map((item, j) => (
            <li key={j}>{inline(item, cite, `${k}.${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    // The first line is always consumed so unusual lines cannot stall the loop.
    const para: string[] = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>)/.test(lines[i]) &&
      !listItem.test(lines[i]) &&
      !(lines[i].includes("|") && isTableRule(lines[i + 1]))
    )
      para.push(lines[i++]);
    blocks.push(
      <p key={k}>
        {para.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(l, cite, `${k}.${j}`)}
          </span>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
