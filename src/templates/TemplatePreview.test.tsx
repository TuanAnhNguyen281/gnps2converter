import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplatePreview } from "./TemplatePreview";
import {
  DEFAULT_PAGE,
  basicTemplate,
  type TemplateReport,
} from "../../server/shared/report-template";

const report: TemplateReport = {
  title: "Báo cáo <x>",
  exportedAt: "2026-10-23T03:00:00Z",
  parameters: { mzMode: "ppm", mzTolerance: 10, rtTolerance: 0.3 },
  rows: Array.from({ length: 55 }, (_, i) => ({
    id: `r${i}`,
    selected: true,
    status: "matched",
    compoundName: `Hợp chất ${i + 1}`,
    molecularFormula: "C6H12O6",
    deltaPpm: i,
    sourceMetadata: {},
  })),
};

describe("template preview", () => {
  it("fills fields, repeats rows with a cap and escapes text", () => {
    const html = renderToStaticMarkup(
      <TemplatePreview
        doc={basicTemplate()}
        page={DEFAULT_PAGE}
        report={report}
      />,
    );
    expect(html).toContain("Báo cáo &lt;x&gt;");
    expect(html).toContain("Hợp chất 50");
    expect(html).not.toContain("Hợp chất 51");
    expect(html).toContain("còn 5 dòng nữa");
    expect(html).toContain("C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>");
    expect(html).toContain("width:297mm");
  });
});
