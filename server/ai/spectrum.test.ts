import { describe, expect, it } from "vitest";
import { fetchMirrorPng, gnpsTask, mirrorSpec } from "./spectrum.js";
import { IMAGE_TOKENS, estimatePromptTokens, withoutImages } from "./tokens.js";

const task = "2515573ac8c24ec8b85f553aad9b440e";
describe("mirror plot", () => {
  it("finds the GNPS2 task from data or the source URL", () => {
    expect(gnpsTask({ task: task.toUpperCase() }, null)).toBe(task);
    expect(gnpsTask({}, `https://gnps2.org/status?task=${task}`)).toBe(task);
    expect(gnpsTask({ task: "../x" }, "not a url")).toBeNull();
  });
  it("builds USIs only from a numeric scan and a GNPS library id", () => {
    const spec = mirrorSpec(task, {
      sourceMetadata: { "#Scan#": "33", SpectrumID: "CCMSLIB00005720803" },
    });
    expect(spec.usi1).toBe(
      `mzspec:GNPS2:TASK-${task}-nf_output/clustering/specs_ms.mgf:scan:33`,
    );
    expect(spec.usi2).toBe(
      "mzspec:GNPS:GNPS-LIBRARY:accession:CCMSLIB00005720803",
    );
    expect(() =>
      mirrorSpec(null, { sourceMetadata: { "#Scan#": "33" } }),
    ).toThrow("task GNPS2");
    expect(() =>
      mirrorSpec(task, {
        sourceMetadata: {
          "#Scan#": "33&x=1",
          SpectrumID: "CCMSLIB00005720803",
        },
      }),
    ).toThrow();
    expect(() =>
      mirrorSpec(task, { sourceMetadata: { "#Scan#": "33", SpectrumID: "x" } }),
    ).toThrow("SpectrumID");
  });
  it("accepts PNG only and caps the size", async () => {
    const urls: string[] = [];
    const png = await fetchMirrorPng(
      { usi1: "a b", usi2: "c" },
      async (url) => {
        urls.push(url);
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        });
      },
    );
    expect(png).toBe("data:image/png;base64,iVBORw==");
    expect(urls[0]).toBe(
      "https://metabolomics-usi.gnps2.org/png/mirror/?usi1=a%20b&usi2=c",
    );
    await expect(
      fetchMirrorPng({ usi1: "a", usi2: "b" }, async () =>
        Response.json({ error: 1 }),
      ),
    ).rejects.toThrow("không trả ảnh");
    await expect(
      fetchMirrorPng(
        { usi1: "a", usi2: "b" },
        async () =>
          new Response(new Uint8Array(1_600_000), {
            headers: { "content-type": "image/png" },
          }),
      ),
    ).rejects.toThrow("quá lớn");
  });
  it("counts an inline image as a fixed token cost, not base64 length", () => {
    const image = {
      role: "user",
      content: [
        { type: "text", text: "Xem phổ" },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${"A".repeat(90000)}` },
        },
      ],
    };
    const text = { role: "user", content: "Xem phổ" };
    expect(
      estimatePromptTokens([image]) - estimatePromptTokens([text]),
    ).toBeLessThan(IMAGE_TOKENS + 40);
    expect(withoutImages(image)).toContain('"url":"<image>"');
  });
});
