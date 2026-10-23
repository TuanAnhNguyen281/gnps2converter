import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { renderTemplateDocx } from "./render.js";
import {
  basicTemplate,
  fieldValue,
  repeatRows,
  sanitizePage,
  sanitizeTemplate,
  type TemplateReport,
} from "../shared/report-template.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcO7WQAAAABJRU5ErkJggg==";
const report: TemplateReport = {
  title: "Flavonoid <b>",
  sourceUrl: "https://gnps2.org/status?task=abc",
  task: null,
  exportedAt: "2026-10-23T03:00:00Z",
  parameters: { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.3 },
  summary: { tsvRows: 3, dataRows: 3 },
  discussion: "## Nhận xét\n- **Quercetin** khớp tốt",
  rows: [
    {
      id: "a",
      selected: true,
      status: "matched",
      compoundName: "Quercetin",
      molecularFormula: "C15H10O7",
      deltaPpm: 1.23456789,
      rtDisplay: "4.5",
      structureData: png,
      sourceMetadata: { MQScore: 0.91 },
    },
    {
      id: "b",
      selected: false,
      status: "unmatched",
      compoundName: "Rutin",
      molecularFormula: "C27H30O16",
      deltaPpm: -22.5,
      sourceMetadata: {},
    },
    {
      id: "c",
      selected: true,
      status: "ambiguous",
      compoundName: "Luteolin",
      molecularFormula: "C15H10O6",
      deltaPpm: 14,
      sourceMetadata: {},
    },
  ],
};
async function documentXml(buffer: Buffer) {
  return (await JSZip.loadAsync(buffer))
    .file("word/document.xml")!
    .async("string");
}

describe("template fields", () => {
  it("formats values like the default export", () => {
    expect(fieldValue("row.ppm", report, report.rows[0], 0)).toEqual({
      kind: "text",
      text: "1,23457",
    });
    expect(fieldValue("row.ppm", report, report.rows[0], 0, 1)).toEqual({
      kind: "text",
      text: "1,2",
    });
    expect(fieldValue("row.rt", report, report.rows[0], 0)).toEqual({
      kind: "text",
      text: "4,5",
    });
    expect(fieldValue("row.index", report, report.rows[0], 4)).toEqual({
      kind: "text",
      text: "5",
    });
    expect(fieldValue("row.mqScore", report, report.rows[0], 0)).toEqual({
      kind: "text",
      text: "0,91",
    });
    expect(fieldValue("summary.exportedRows", report)).toEqual({
      kind: "text",
      text: "2",
    });
    // Row fields outside a repeat row are empty, not errors.
    expect(fieldValue("row.compoundName", report)).toEqual({
      kind: "text",
      text: "",
    });
  });
  it("filters and sorts repeated rows", () => {
    expect(repeatRows(report.rows, null).map((r) => r.id)).toEqual(["a", "c"]);
    expect(
      repeatRows(report.rows, { filter: "all", sort: "abs_ppm_desc" }).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "c", "a"]);
    expect(
      repeatRows(report.rows, { filter: "unmatched", sort: "report" }).map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
  });
});

describe("template sanitizing", () => {
  it("drops unknown nodes, marks, attributes and field keys", () => {
    const doc = sanitizeTemplate({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center", onclick: "x" },
          content: [
            {
              type: "text",
              text: "Hi",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "javascript:x" } },
              ],
            },
            { type: "field", attrs: { key: "report.title", decimals: 99 } },
            { type: "field", attrs: { key: "process.env" } },
            { type: "image", attrs: { src: "http://x" } },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "rm -rf" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              attrs: { repeat: { filter: "evil", sort: "x" } },
              content: [{ type: "tableCell", attrs: { colspan: 900 } }],
            },
          ],
        },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            { type: "text", text: "Hi", marks: [{ type: "bold" }] },
            { type: "field", attrs: { key: "report.title", decimals: 3 } },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              attrs: { repeat: { filter: "selected", sort: "report" } },
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", attrs: { textAlign: null } }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => sanitizeTemplate({ type: "paragraph" })).toThrow();
    expect(
      sanitizePage({ orientation: "x", margins: { top: 1000 } }),
    ).toMatchObject({ orientation: "landscape", margins: { top: 20 } });
  });
});

describe("template DOCX", () => {
  it("renders the basic template with repeated rows, subscripts and images", async () => {
    const xml = await documentXml(
      await renderTemplateDocx(
        basicTemplate(),
        sanitizePage({ orientation: "landscape" }),
        report,
      ),
    );
    expect(xml).toContain("Flavonoid &lt;b&gt;");
    expect(xml).not.toContain("<b>");
    // Two selected rows: Quercetin and Luteolin, not the unselected Rutin.
    expect(xml).toContain("Quercetin");
    expect(xml).toContain("Luteolin");
    expect(xml).not.toContain("Rutin");
    expect((xml.match(/<w:tr[ >]/g) ?? []).length).toBe(3);
    expect(xml).toMatch(/<w:vertAlign w:val="subscript"\/>/);
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1);
    expect(xml).toContain('w:orient="landscape"');
  });
  it("expands the discussion field and numbers lists", async () => {
    const xml = await documentXml(
      await renderTemplateDocx(
        sanitizeTemplate({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "field", attrs: { key: "ai.discussion" } }],
            },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Bước một" }],
                    },
                  ],
                },
              ],
            },
            { type: "pageBreak" },
          ],
        }),
        sanitizePage({ orientation: "portrait" }),
        report,
      ),
    );
    expect(xml).toContain("Nhận xét");
    expect(xml).toContain("• Quercetin khớp tốt");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).not.toContain('w:orient="landscape"');
  });
});
