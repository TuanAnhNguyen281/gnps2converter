import JSZip from "jszip";

const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Bold (**x**) becomes a bold run; other Markdown marks are dropped.
function runs(text: string, size: number) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => {
      const bold = /^\*\*[^*]+\*\*$/.test(part),
        body = bold ? part.slice(2, -2) : part;
      return `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(body)}</w:t></w:r>`;
    })
    .join("");
}
// Converts the reviewed draft (Markdown subset) into WordprocessingML paragraphs.
export function discussionParagraphs(markdown: string) {
  const out = [
    `<w:p><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>KẾT QUẢ VÀ THẢO LUẬN</w:t></w:r></w:p>`,
  ];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line)) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line),
      item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading)
      out.push(
        `<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>${runs(`**${heading[1].replace(/\*\*/g, "")}**`, 24)}</w:p>`,
      );
    else if (item)
      out.push(
        `<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>${runs(`• ${item[1]}`, 22)}</w:p>`,
      );
    else if (line.startsWith("|"))
      out.push(
        `<w:p>${runs(
          line
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim())
            .join(" · "),
          22,
        )}</w:p>`,
      );
    else out.push(`<w:p>${runs(line.replace(/^>\s?/, ""), 22)}</w:p>`);
  }
  out.push(
    `<w:p><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Nháp do AI hỗ trợ soạn từ dữ liệu báo cáo và đã được người dùng duyệt trước khi xuất.</w:t></w:r></w:p>`,
  );
  return out.join("");
}
// Appends the section at the end of the body, before the final section properties.
export async function appendDiscussion(docx: Buffer, markdown: string) {
  const zip = await JSZip.loadAsync(docx),
    part = zip.file("word/document.xml");
  if (!part || !markdown.trim()) return docx;
  const document = await part.async("string"),
    at = document.lastIndexOf("<w:sectPr"),
    end = document.lastIndexOf("</w:body>"),
    index = at > 0 && at < end ? at : end;
  if (index < 0) return docx;
  zip.file(
    "word/document.xml",
    document.slice(0, index) +
      discussionParagraphs(markdown) +
      document.slice(index),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
