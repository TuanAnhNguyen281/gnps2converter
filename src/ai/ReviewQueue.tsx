import { useEffect, useState } from "react";
import { jsonApi } from "../api";

interface QueueItem {
  rowId: string;
  compoundName: string | null;
  sourceTsvRow: number | null;
  status: string;
  score: number;
  reasons: string[];
}
interface Queue {
  examinedRows: number;
  flaggedRows: number;
  rule: string;
  items: QueueItem[];
}
// Server-ranked rows to check first; works without calling any AI provider.
export function ReviewQueue({
  reportId,
  revision,
  onOpenRow,
}: {
  reportId: string;
  revision?: number;
  onOpenRow: (rowId: string) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    void jsonApi<Queue>(`/api/ai/reports/${reportId}/review-queue?limit=10`)
      .then((q) => alive && setQueue(q))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [reportId, revision]);
  if (error) return <p className="ai-error">{error}</p>;
  if (!queue) return null;
  return (
    <details className="ai-card review-queue">
      <summary>
        Hàng đợi duyệt · {queue.flaggedRows}/{queue.examinedRows} dòng nên kiểm
        tra
      </summary>
      {queue.items.length ? (
        <ol>
          {queue.items.map((item) => (
            <li key={item.rowId}>
              <button type="button" onClick={() => onOpenRow(item.rowId)}>
                <b>{item.compoundName || "Không tên"}</b>
                {item.sourceTsvRow ? ` · dòng TSV ${item.sourceTsvRow}` : ""}
              </button>
              <span
                className={`review-score${item.score >= 60 ? " high" : ""}`}
                aria-label={`Điểm cần duyệt ${item.score}`}
              >
                {item.score}
              </span>
              <small>{item.reasons.join(" · ")}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p>Không có dòng nào vượt ngưỡng cần duyệt.</p>
      )}
      <small className="review-rule">{queue.rule}</small>
    </details>
  );
}
