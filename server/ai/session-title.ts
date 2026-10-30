// Session titles: an immediate one cut from the first question, then a short
// model-written summary that replaces it unless the user renamed the session.
const MAX = 80;

function clip(text: string, max = MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1),
    space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

export function draftTitle(question: string) {
  const text = question.replace(/\s+/g, " ").trim(),
    // The first sentence usually carries the question.
    first = text.match(/^.+?[?.!](?=\s|$)/)?.[0] ?? text;
  return clip(first || "Phiên nghiên cứu");
}

export function titleMessages(question: string) {
  return [
    {
      role: "system",
      content:
        "Đặt tiêu đề ngắn (tối đa 8 từ) bằng tiếng Việt cho phiên nghiên cứu bắt đầu bằng câu hỏi của người dùng. Chỉ trả về tiêu đề, không ngoặc kép, không dấu chấm cuối, không giải thích.",
    },
    { role: "user", content: question.slice(0, 2000) },
  ];
}

// Model output is untrusted: keep one plain line or give up (null).
export function cleanTitle(raw: unknown) {
  if (typeof raw !== "string") return null;
  const line = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const text = line
    .replace(/^(tiêu đề|title)\s*:\s*/i, "")
    .replace(/[*_`#]/g, "")
    // Quotes and a final full stop, in either order ("…". or "….").
    .replace(/^["'“”‘’«»]+|["'“”‘’«».。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? clip(text) : null;
}
