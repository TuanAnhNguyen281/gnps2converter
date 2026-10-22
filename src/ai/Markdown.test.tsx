import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const html = (
  text: string,
  citations?: Parameters<typeof Markdown>[0]["citations"],
) =>
  renderToStaticMarkup(
    <Markdown text={text} citations={citations} onCite={() => {}} />,
  );

describe("Markdown", () => {
  it("escapes HTML and only links http(s) URLs", () => {
    const out = html(
      "<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](https://gnps2.org)",
    );
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('href="https://gnps2.org"');
  });
  it("renders headings, lists, tables and code", () => {
    const out = html(
      "## Kết quả\n\n- **A** có `ppm`\n- B\n\n1. một\n2. hai\n\n| Hợp chất | ppm |\n|---|---:|\n| X | 8 |\n\n```\nraw *text*\n```",
    );
    expect(out).toContain("<h4>Kết quả</h4>");
    expect(out).toContain(
      "<ul><li><strong>A</strong> có <code>ppm</code></li><li>B</li></ul>",
    );
    expect(out).toContain('<ol start="1"><li>một</li><li>hai</li></ol>');
    expect(out).toContain("<th>Hợp chất</th>");
    expect(out).toContain("<td>8</td>");
    expect(out).toContain("<pre><code>raw *text*</code></pre>");
  });
  it("renders citation chips with validation status", () => {
    const out = html("Xem [R1-1, R1-9] và [R2]", [
      { ref: "R1-1", reportId: "r", rowId: "a", status: "ok" },
      { ref: "R1-9", reportId: null, rowId: null, status: "invalid" },
    ]);
    expect(out).toContain('class="citation ok"');
    expect(out).toContain('class="citation invalid"');
    expect(out).toContain('class="citation pending"');
  });
  it("does not stall on lines that resemble block syntax", () => {
    expect(html("  # not heading\n| a |\n>\n-\n***")).toContain("not heading");
  });
});
