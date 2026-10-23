import { useEffect, useState } from "react";
import { jsonApi, jsonBody } from "../api";

export const DRAFT_EVENT = "gnps-discussion-updated";
interface Draft {
  content: string;
  updated_at?: string;
}
// The reviewed draft that the Word export appends as "Kết quả và thảo luận".
export function DiscussionDraft({ reportId }: { reportId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null),
    [text, setText] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void jsonApi<Draft | null>(`/api/ai/reports/${reportId}/discussion`)
        .then((d) => {
          if (!alive) return;
          setDraft(d);
          setText(d?.content ?? "");
        })
        .catch((e) => alive && setStatus((e as Error).message));
    load();
    const onUpdate = (e: Event) => {
      if ((e as CustomEvent<string>).detail === reportId) load();
    };
    window.addEventListener(DRAFT_EVENT, onUpdate);
    return () => {
      alive = false;
      window.removeEventListener(DRAFT_EVENT, onUpdate);
    };
  }, [reportId]);
  if (!draft) return null;
  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    setStatus("");
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="ai-card discussion-draft" open>
      <summary>Nháp “Kết quả và thảo luận” · sẽ thêm vào file Word</summary>
      <textarea
        aria-label="Nội dung nháp Kết quả và thảo luận"
        value={text}
        maxLength={20000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ai-actions">
        <button
          type="button"
          disabled={busy || !text.trim() || text === draft.content}
          onClick={() =>
            void run(async () => {
              const saved = await jsonApi<Draft>(
                `/api/ai/reports/${reportId}/discussion`,
                jsonBody({ content: text }, "PUT"),
              );
              setDraft(saved);
            }, "Đã lưu nháp.")
          }
        >
          Lưu nháp
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await jsonApi(
                `/api/ai/reports/${reportId}/discussion`,
                jsonBody({}, "DELETE"),
              );
              setDraft(null);
            }, "")
          }
        >
          Bỏ khỏi Word
        </button>
      </div>
      <small>
        Hãy đọc và sửa trước khi xuất: đây là nháp AI, trích dẫn đã đổi sang tên
        báo cáo và dòng TSV.
        {status && ` ${status}`}
      </small>
    </details>
  );
}
