import { useEffect, useState } from "react";
import { jsonApi } from "../api";

interface AdminData {
  days: number;
  queue: {
    queued: number;
    running: number;
    oldest_queued_seconds: number | null;
    maxConcurrent: number;
    maxQueued: number;
  };
  accounts: {
    email: string;
    display_name: string;
    requests: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    last_request_at: string;
  }[];
  models: {
    provider_name: string;
    model_id: string;
    accounts: number;
    requests: number;
    failed: number;
    interrupted: number;
    input_tokens: number;
    output_tokens: number;
  }[];
  errors: {
    error_code: string;
    count: number;
    last_at: string | null;
    last_message: string | null;
  }[];
}
const fmt = (n: number) => n.toLocaleString("vi-VN");
const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("vi-VN") : "—";
// Rendered only when the API grants admin access; a 403 hides it silently.
export function AdminUsage() {
  const [data, setData] = useState<AdminData | null>(null);
  useEffect(() => {
    let alive = true;
    void jsonApi<AdminData>("/api/ai/admin/usage?days=30")
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  return (
    <details className="ai-card usage-summary admin-usage">
      <summary>Quản trị · AI toàn hệ thống {data.days} ngày</summary>
      <p>
        Hàng đợi: {data.queue.running}/{data.queue.maxConcurrent} đang chạy ·{" "}
        {data.queue.queued}/{data.queue.maxQueued} đang chờ
        {data.queue.oldest_queued_seconds !== null
          ? ` · lâu nhất ${data.queue.oldest_queued_seconds}s`
          : ""}
      </p>
      <div className="md-table">
        <table>
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Lượt</th>
              <th>Lỗi</th>
              <th>Token vào</th>
              <th>Token ra</th>
              <th>Từ cache</th>
              <th>Gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.email}>
                <td>
                  {a.display_name} · {a.email}
                </td>
                <td>{a.requests}</td>
                <td>{a.failed}</td>
                <td>{fmt(a.input_tokens)}</td>
                <td>{fmt(a.output_tokens)}</td>
                <td>
                  {a.cached_input_tokens ? fmt(a.cached_input_tokens) : "—"}
                </td>
                <td>{when(a.last_request_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Provider · model</th>
              <th>Tài khoản</th>
              <th>Lượt</th>
              <th>Lỗi</th>
              <th>Gián đoạn</th>
              <th>Token vào</th>
              <th>Token ra</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={`${m.provider_name}|${m.model_id}`}>
                <td>
                  {m.provider_name} · {m.model_id}
                </td>
                <td>{m.accounts}</td>
                <td>{m.requests}</td>
                <td>{m.failed}</td>
                <td>{m.interrupted}</td>
                <td>{fmt(m.input_tokens)}</td>
                <td>{fmt(m.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!data.errors.length && (
          <table>
            <thead>
              <tr>
                <th>Mã lỗi</th>
                <th>Số lần</th>
                <th>Gần nhất</th>
                <th>Thông báo gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {data.errors.map((e) => (
                <tr key={e.error_code}>
                  <td>{e.error_code}</td>
                  <td>{e.count}</td>
                  <td>{when(e.last_at)}</td>
                  <td>{e.last_message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <small>
        Chỉ số đếm và tổng token; không hiển thị nội dung câu hỏi hoặc câu trả
        lời.
      </small>
    </details>
  );
}
