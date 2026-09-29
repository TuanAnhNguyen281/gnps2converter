export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
export const apiUrl = (path: string) => `${apiBaseUrl}${path}`;
let csrf = "";
let initializing: Promise<void> | undefined;
export function setCsrf(token: string) {
  csrf = token;
}
export async function apiFetch(input: string, options: RequestInit = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !csrf) {
    initializing ??= fetch(apiUrl("/api/auth/csrf"), { credentials: "include" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            "Không khởi tạo được phiên. Kiểm tra cấu hình backend.",
          );
        csrf = (await r.json()).csrf;
      })
      .finally(() => {
        initializing = undefined;
      });
    await initializing;
  }
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(input, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 401 && !input.includes("/api/auth/"))
    window.dispatchEvent(new Event("gnps-session-expired"));
  return response;
}
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export interface PipelineProgress {
  stage:
    | "task"
    | "matches"
    | "network"
    | "enrichment"
    | "database"
    | "assets"
    | "complete";
  step: number;
  totalSteps: number;
  percent: number;
  title: string;
  message: string;
  detail?: string;
  current?: number;
  total?: number;
  succeeded?: number;
  failed?: number;
  outcome?: "working" | "success" | "partial";
}
export async function postProgressStream<T>(
  path: string,
  options: RequestInit,
  onProgress: (progress: PipelineProgress) => void,
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new HttpError(
      body.message ?? "Yêu cầu thất bại.",
      response.status,
      body.code,
    );
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return (await response.json()) as T;
  if (!response.body) throw new Error("Máy chủ không gửi được tiến trình.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: any;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      throw new Error("Tiến trình từ máy chủ không hợp lệ.");
    }
    if (event === "progress") onProgress(payload as PipelineProgress);
    else if (event === "error")
      throw new HttpError(payload.message ?? "Không thể hoàn tất yêu cầu.", 500, payload.code);
    else if (event === "result") result = payload as T;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      dispatch(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  if (result === undefined)
    throw new Error("Máy chủ đã kết thúc trước khi gửi kết quả.");
  return result;
}
export async function jsonApi<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await apiFetch(apiUrl(path), options);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new HttpError(
      body.message ?? "Yêu cầu thất bại.",
      r.status,
      body.code,
    );
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}
export const jsonBody = (value: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
