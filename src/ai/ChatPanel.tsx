import { useEffect, useRef, useState } from "react";
import { apiUrl, jsonApi, jsonBody, apiFetch } from "../api";
import { ModelPicker, QuotaMeter, firstModel, modelLabel } from "./AiSettings";
import { useConfirm } from "../Ui";
import { Markdown } from "./Markdown";
import { DRAFT_EVENT } from "./DiscussionDraft";
import { ContextMeter } from "./ContextMeter";
import type {
  Citation,
  Conversation,
  Message,
  Provider,
  ProviderQuota,
  Report,
  TokenPreview,
  RequestState,
  Session,
} from "./types";
const fmtTokens = (n: number) => n.toLocaleString("vi-VN");
// A conversation started by a question is named after it.
const conversationTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
};
const TOOL_LABELS: Record<string, string> = {
  get_project_overview: "tổng quan project",
  list_project_reports: "danh sách báo cáo",
  get_report_summary: "tóm tắt báo cáo",
  query_report_rows: "lọc dòng",
  get_compound_details: "chi tiết hợp chất",
  compare_reports: "so sánh báo cáo",
  get_review_queue: "hàng đợi duyệt",
  aggregate_report: "thống kê nhóm",
  distribution: "phân bố",
  find_duplicates: "tìm trùng",
  lookup_compound: "tra cứu PubChem/NPClassifier",
};
type RowOverride = { reportIds: string[]; rowIds: string[] };
interface CitationRow extends Citation {
  reportTitle: string | null;
  revision: number | null;
  row: {
    compoundName: string | null;
    adduct: string | null;
    mzTsv: number | null;
    ppm: number | null;
    rt: string | number | null;
    status: string | null;
    sourceTsvRow: number | null;
  } | null;
}
// Sent as a normal turn: the truncated answer is in history, so the model resumes from it.
const CONTINUE_PROMPT =
  "Tiếp tục câu trả lời trước từ đúng chỗ bị cắt, không lặp lại phần đã viết.";
export interface ChatContext {
  viewState?: { filter: string; sort: string };
  reportId: string | null;
  revision: number;
  selectedRowIds: string[];
}
export function ChatPanel({
  session,
  reports,
  providers,
  beforeSend,
  onOpenReport,
  compact = false,
  contextKey,
  initialQuestion,
  initialModel,
}: {
  session: Session;
  // Sent once on mount: the question that started this session.
  initialQuestion?: string;
  // Model picked for that question ("providerId|modelId").
  initialModel?: string;
  reports: Report[];
  providers: Provider[];
  // save=false: read the current context without flushing edits (used for previews).
  beforeSend: (options?: { save?: boolean }) => Promise<ChatContext>;
  onOpenReport: (id: string, rowIds?: string[]) => Promise<void>;
  compact?: boolean;
  // Changes when the host's selection/report changes, so the preview refreshes.
  contextKey?: unknown;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [conversationSearch, setConversationSearch] = useState(""),
    [defaultChoice, setDefaultChoice] = useState(""),
    [conversation, setConversation] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [question, setQuestion] = useState(""),
    [choice, setChoice] = useState(initialModel ?? ""),
    [scope, setScope] = useState<"selection" | "report" | "project">(
      "selection",
    ),
    [chosenReports, setChosenReports] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState<RequestState | null>(null),
    [sourceInfo, setSourceInfo] = useState<Record<string, RequestState>>({}),
    [quotas, setQuotas] = useState<Record<string, ProviderQuota | undefined>>(
      {},
    ),
    [preview, setPreview] = useState<TokenPreview | null>(null),
    [checked, setChecked] = useState<Record<string, CitationRow[]>>({}),
    [notice, setNotice] = useState(""),
    [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({}),
    [attachSpectrum, setAttachSpectrum] = useState(false),
    // Conversation whose "start a new chat" hint was dismissed.
    [hintDismissed, setHintDismissed] = useState(""),
    [previewError, setPreviewError] = useState("");
  // Quota is shared by every chat on the provider, so re-read it after each turn.
  async function refreshQuotas() {
    try {
      const list = await jsonApi<Provider[]>("/api/ai/providers");
      setQuotas(Object.fromEntries(list.map((p) => [p.id, p.quota])));
    } catch {
      // Quota display is advisory; the server still enforces the limit.
    }
  }
  useEffect(() => {
    setQuotas(Object.fromEntries(providers.map((p) => [p.id, p.quota])));
  }, [providers]);
  const generation = useRef(0),
    stream = useRef<EventSource | null>(null),
    sending = useRef(false),
    pending = useRef<{ id: string; signature: string } | null>(null),
    polling = useRef<ReturnType<typeof setTimeout> | null>(null),
    initial = useRef(initialQuestion),
    switcher = useRef<HTMLDetailsElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    log = useRef<HTMLDivElement>(null),
    // Keep the newest message in view unless the reader scrolled up.
    following = useRef(true);
  useEffect(() => {
    if (following.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);
  const confirm = useConfirm();
  const effectiveChoice = choice || defaultChoice;
  const [effectiveProviderId, effectiveModelId] = effectiveChoice.split("|");
  const effectiveProvider = providers.find((p) => p.id === effectiveProviderId);
  useEffect(() => {
    let alive = true;
    void jsonApi<
      {
        scope: string;
        scope_id: string;
        provider_id: string;
        model_id: string;
      }[]
    >("/api/ai/settings")
      .then((rows) => {
        if (!alive) return;
        const setting =
          rows.find(
            (s) => s.scope === "session" && s.scope_id === session.id,
          ) ??
          rows.find(
            (s) => s.scope === "project" && s.scope_id === session.project_id,
          ) ??
          rows.find((s) => s.scope === "account");
        setDefaultChoice(
          setting
            ? `${setting.provider_id}|${setting.model_id}`
            : firstModel(providers),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session.id, providers]);
  const active = messages.some(
    (m) => m.role === "assistant" && ["queued", "running"].includes(m.state),
  );
  async function loadConversations() {
    const rows = await jsonApi<Conversation[]>(
      `/api/research-sessions/${session.id}/conversations`,
    );
    setConversations(rows);
    return rows;
  }
  useEffect(() => {
    let alive = true;
    setConversation("");
    setMessages([]);
    setRequest(null);
    setSourceInfo({});
    setError("");
    setChoice(initial.current ? (initialModel ?? "") : "");
    setChosenReports([]);
    pending.current = null;
    void jsonApi<Conversation[]>(
      `/api/research-sessions/${session.id}/conversations`,
    )
      .then((rows) => {
        if (!alive) return;
        setConversations(rows);
        const open = rows.find((c) => !c.archived_at)?.id ?? "";
        setConversation(open);
        const first = initial.current;
        initial.current = undefined;
        // Left in the box so a failed send can be retried.
        if (first && !open) {
          setQuestion(first);
          void send(first);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      generation.current++;
      stream.current?.close();
      if (polling.current) clearTimeout(polling.current);
    };
  }, [session.id]);
  async function loadMessages(id: string) {
    return jsonApi<{ items: Message[]; nextCursor: number | null }>(
      `/api/ai/conversations/${id}/messages`,
    );
  }
  function observe(id: string, gen: number, conversationId: string) {
    stream.current?.close();
    if (polling.current) clearTimeout(polling.current);
    const apply = async (data: RequestState) => {
      if (generation.current !== gen) return;
      setRequest(data);
      setSourceInfo((prev) => ({ ...prev, [id]: data }));
      setMessages((prev) =>
        prev.map((m) =>
          m.request_id === id && m.role === "assistant"
            ? {
                ...m,
                content: data.content,
                citations: data.citations,
                finish_reason: data.finishReason,
                queue_position: data.queuePosition,
                tool_progress: data.toolRuns.map((t) => t.tool_name),
                status: data.state,
                state: data.state,
                error_message: data.error,
              }
            : m,
        ),
      );
      if (!["queued", "running"].includes(data.state)) {
        stream.current?.close();
        if (polling.current) clearTimeout(polling.current);
        const loaded = await loadMessages(conversationId);
        if (generation.current === gen) {
          setMessages(loaded.items);
          setCursor(loaded.nextCursor);
          void loadConversations().catch(() => {});
          void refreshQuotas();
        }
      }
    };
    const poll = async () => {
      if (generation.current !== gen) return;
      try {
        const data = await jsonApi<RequestState>(`/api/ai/requests/${id}`);
        await apply(data);
        if (
          generation.current === gen &&
          ["queued", "running"].includes(data.state)
        )
          polling.current = setTimeout(poll, 2000);
      } catch (e) {
        if (generation.current === gen)
          setError(
            `Mất kết nối. Mở lại hội thoại để theo dõi. ${(e as Error).message}`,
          );
      }
    };
    const es = new EventSource(apiUrl(`/api/ai/requests/${id}/events`), {
      withCredentials: true,
    });
    stream.current = es;
    es.addEventListener("state", (e) => {
      try {
        void apply(JSON.parse((e as MessageEvent).data)).catch(() => {});
      } catch {
        es.close();
        void poll();
      }
    });
    es.onerror = () => {
      es.close();
      void poll();
    };
  }
  useEffect(() => {
    const gen = ++generation.current;
    stream.current?.close();
    if (polling.current) clearTimeout(polling.current);
    setMessages([]);
    setRequest(null);
    setCursor(null);
    setError("");
    if (!conversation) return;
    void loadMessages(conversation)
      .then((loaded) => {
        if (generation.current !== gen) return;
        setMessages(loaded.items);
        setCursor(loaded.nextCursor);
        const current = loaded.items.find(
          (m) =>
            m.role === "assistant" && ["queued", "running"].includes(m.state),
        );
        if (current) observe(current.request_id, gen, conversation);
      })
      .catch((e) => {
        if (generation.current === gen) setError(e.message);
      });
    return () => {
      generation.current++;
      stream.current?.close();
      if (polling.current) clearTimeout(polling.current);
    };
  }, [conversation]);
  // A new chat is only a blank draft; the first question creates it on the server.
  function newConversation() {
    if (sending.current) return;
    pending.current = null;
    setConversation("");
    setQuestion("");
    textarea.current?.focus();
  }
  function closeSwitcher() {
    if (switcher.current) switcher.current.open = false;
  }
  // Shared by send and preview so both describe exactly the same request.
  function buildPayload(
    text: string,
    context: ChatContext,
    retryOf?: string,
    rows?: RowOverride,
  ) {
    // A row override (citation re-check) sends exactly those rows.
    if (rows)
      context = { ...context, reportId: null, selectedRowIds: rows.rowIds };
    const effectiveScope = rows ? "selection" : scope;
    const reportIds = rows
      ? rows.reportIds
      : scope === "project"
        ? chosenReports.length
          ? chosenReports
          : reports.map((r) => r.id)
        : context.reportId
          ? [context.reportId]
          : session.active_report_id
            ? [session.active_report_id]
            : [];
    if (!reportIds.length)
      throw new Error("Hãy mở báo cáo hoặc chọn phạm vi project.");
    if (effectiveScope === "selection" && context.selectedRowIds.length > 300)
      throw new Error("Chọn tối đa 300 dòng hoặc chuyển sang toàn báo cáo.");
    const expectedRevisions = Object.fromEntries(
      reports
        .filter((r) => reportIds.includes(r.id))
        .map((r) => [r.id, r.revision]),
    );
    if (context.reportId && reportIds.includes(context.reportId))
      expectedRevisions[context.reportId] = context.revision;
    // Sent explicitly so the fallback model works with no saved default.
    const [providerId, modelId] = effectiveChoice.split("|");
    return {
      message: text,
      // The mirror plot needs exactly one selected row.
      ...(attachSpectrum &&
      !rows &&
      effectiveScope === "selection" &&
      context.selectedRowIds.length === 1
        ? { attachSpectrum: true }
        : {}),
      ...(retryOf ? { retryOf } : {}),
      ...(effectiveChoice ? { providerId, modelId } : {}),
      context: {
        reportIds,
        scope: effectiveScope,
        selectedRowIds:
          effectiveScope === "selection" ? context.selectedRowIds : [],
        viewState: context.viewState,
        expectedRevisions,
      },
    };
  }
  useEffect(() => {
    if (!conversation || isArchived || active) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const payload = buildPayload(
            question,
            await beforeSend({ save: false }),
          );
          const r = await jsonApi<TokenPreview>(
            `/api/ai/conversations/${conversation}/preview`,
            jsonBody({
              ...payload,
              // Unsaved edits are flushed on send; the preview only estimates size.
              context: { ...payload.context, expectedRevisions: {} },
            }),
          );
          if (alive) {
            setPreview(r);
            setPreviewError("");
          }
        } catch (e) {
          if (alive) {
            setPreview(null);
            setPreviewError((e as Error).message);
          }
        }
      })();
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    conversation,
    question,
    scope,
    choice,
    chosenReports,
    reports,
    messages.length,
    active,
    contextKey,
    attachSpectrum,
  ]);
  // Copies a finished answer into the report's Word draft for the user to edit.
  async function saveAsDraft(requestId: string) {
    const context = await beforeSend({ save: false }),
      reportId = context.reportId ?? session.active_report_id;
    if (!reportId)
      throw new Error("Hãy mở báo cáo cần gắn phần Kết quả và thảo luận.");
    await jsonApi(
      `/api/ai/reports/${reportId}/discussion`,
      jsonBody({ requestId }, "PUT"),
    );
    window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: reportId }));
    setNotice(
      "Đã lưu làm nháp “Kết quả và thảo luận”. Hãy đọc và sửa ở mục nháp trước khi xuất Word.",
    );
  }
  // Clicking the active rating again (without a comment) clears it.
  async function rate(m: Message, rating: 1 | -1, comment = "") {
    const clear = m.feedback_rating === rating && !comment;
    await jsonApi(
      `/api/ai/requests/${m.request_id}/feedback`,
      clear ? jsonBody({}, "DELETE") : jsonBody({ rating, comment }, "PUT"),
    );
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? {
              ...x,
              feedback_rating: clear ? null : rating,
              feedback_comment: clear ? null : comment,
            }
          : x,
      ),
    );
  }
  async function loadCitations(requestId: string) {
    const rows = await jsonApi<CitationRow[]>(
      `/api/ai/requests/${requestId}/citations`,
    );
    setChecked((prev) => ({ ...prev, [requestId]: rows }));
    return rows;
  }
  // Sends only the rows behind questionable citations, named by compound
  // because refs are renumbered in the new snapshot.
  async function recheck(requestId: string) {
    const rows = checked[requestId] ?? (await loadCitations(requestId)),
      bad = rows.filter((c) => c.status !== "ok"),
      withRow = bad.filter((c) => c.reportId && c.rowId);
    const names = withRow.map(
      (c) =>
        `${c.row?.compoundName ?? c.ref}${c.row?.sourceTsvRow ? ` (dòng TSV ${c.row.sourceTsvRow})` : ""}`,
    );
    const invalid = bad
      .filter((c) => !c.rowId && !c.reportId)
      .map((c) => c.ref);
    const text = [
      names.length &&
        `Kiểm tra lại số liệu câu trả lời trước về: ${names.join(", ")}, dựa trên dữ liệu các dòng được gửi kèm; xác nhận hoặc sửa từng số liệu và trích dẫn bằng mã mới.`,
      invalid.length &&
        `Các mã ${invalid.join(", ")} không tồn tại: bỏ hoặc sửa các kết luận dùng các mã này.`,
    ]
      .filter(Boolean)
      .join(" ");
    if (!text) return;
    await send(
      text,
      undefined,
      withRow.length
        ? {
            reportIds: [...new Set(withRow.map((c) => c.reportId!))],
            rowIds: [...new Set(withRow.map((c) => c.rowId!))],
          }
        : undefined,
    );
  }
  async function send(text: string, retryOf?: string, rows?: RowOverride) {
    if (
      sending.current ||
      active ||
      !text.trim() ||
      session.status !== "active"
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    const gen = generation.current;
    try {
      const context = await beforeSend();
      if (generation.current !== gen) return;
      const payload = buildPayload(text, context, retryOf, rows),
        signature = JSON.stringify(payload);
      // No conversation yet: the first question starts one.
      const created = conversation
        ? null
        : await jsonApi<Conversation>(
            `/api/research-sessions/${session.id}/conversations`,
            jsonBody({ title: conversationTitle(text) }),
          );
      if (generation.current !== gen) return;
      const target = created?.id ?? conversation;
      if (!pending.current || pending.current.signature !== signature)
        pending.current = { id: crypto.randomUUID(), signature };
      const r = await jsonApi<{ requestId: string }>(
        `/api/ai/conversations/${target}/messages`,
        jsonBody({ clientRequestId: pending.current.id, ...payload }),
      );
      pending.current = null;
      if (generation.current !== gen) return;
      setQuestion("");
      setAttachSpectrum(false);
      if (created) {
        // Switching conversations loads its messages and follows the answer.
        setConversations((prev) => [created, ...prev]);
        setConversation(created.id);
        return;
      }
      const loaded = await loadMessages(target);
      if (generation.current !== gen) return;
      setMessages(loaded.items);
      setCursor(loaded.nextCursor);
      observe(r.requestId, gen, target);
    } catch (e) {
      if (generation.current === gen) setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function sources(id: string) {
    try {
      const data = await jsonApi<RequestState>(`/api/ai/requests/${id}`);
      setSourceInfo((prev) => ({ ...prev, [id]: data }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function exportChat(format: string) {
    try {
      const r = await apiFetch(
        apiUrl(`/api/ai/conversations/${conversation}/export?format=${format}`),
      );
      if (!r.ok) throw new Error("Không xuất được lịch sử.");
      const url = URL.createObjectURL(await r.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `chat-${conversation}.${format === "markdown" ? "md" : "json"}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Makes the chat's chosen model the session default (kept after reload).
  async function rememberModel() {
    const [providerId, modelId] = choice.split("|");
    try {
      await jsonApi(
        "/api/ai/settings",
        jsonBody({
          scope: "session",
          scopeId: session.id,
          providerId,
          modelId,
        }),
      );
      setDefaultChoice(choice);
      setChoice("");
      setNotice("Đã ghi nhớ model cho phiên này.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function rename() {
    const value = window.prompt(
      "Tên hội thoại",
      conversations.find((c) => c.id === conversation)?.title,
    );
    if (value?.trim())
      try {
        await jsonApi(
          `/api/ai/conversations/${conversation}`,
          jsonBody({ title: value }, "PATCH"),
        );
        await loadConversations();
      } catch (e) {
        setError((e as Error).message);
      }
  }
  const isArchived = !!conversations.find((c) => c.id === conversation)
      ?.archived_at,
    compose = busy || active || isArchived || session.status === "closed",
    canSend = !compose && !!question.trim() && preview?.fits !== false;
  const defaultLabel = modelLabel(providers, defaultChoice);
  // The box grows with its text up to the CSS max-height.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);
  return (
    <section className="ai-chat" aria-label="Chat nghiên cứu">
      <header className="chat-topbar">
        <details className="chat-switcher" ref={switcher}>
          <summary>
            <span className="chat-title">
              {conversations.find((c) => c.id === conversation)?.title ??
                "Hội thoại mới"}
              {isArchived ? " · lưu trữ" : ""}
            </span>
            <span aria-hidden="true" className="chat-caret">
              ▾
            </span>
            <small>
              {session.title}
              {session.status === "closed" ? " · phiên đã đóng" : ""}
            </small>
          </summary>
          <div className="chat-menu">
            <input
              aria-label="Tìm hội thoại"
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="Tìm hội thoại…"
            />
            <div className="chat-menu-list" role="list">
              {conversations
                .filter((c) =>
                  c.title
                    .toLowerCase()
                    .includes(conversationSearch.toLowerCase()),
                )
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    disabled={busy}
                    className={c.id === conversation ? "active" : ""}
                    onClick={() => {
                      pending.current = null;
                      setConversation(c.id);
                      closeSwitcher();
                    }}
                  >
                    {c.title}
                    {c.archived_at ? " · lưu trữ" : ""}
                  </button>
                ))}
              {!conversations.length && <small>Chưa có hội thoại nào.</small>}
            </div>
            {conversation && (
              <div className="chat-menu-actions">
                <button type="button" onClick={() => void rename()}>
                  Đổi tên
                </button>
                <button
                  type="button"
                  onClick={() => void exportChat("markdown")}
                >
                  Xuất Markdown
                </button>
                <button type="button" onClick={() => void exportChat("json")}>
                  Xuất JSON
                </button>
                <button
                  type="button"
                  disabled={busy || active}
                  onClick={() =>
                    void jsonApi(
                      `/api/ai/conversations/${conversation}`,
                      jsonBody({ archived: !isArchived }, "PATCH"),
                    )
                      .then(loadConversations)
                      .catch((e) => setError(e.message))
                  }
                >
                  {isArchived ? "Mở lại" : "Lưu trữ"}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy || active}
                  onClick={() =>
                    void (async () => {
                      closeSwitcher();
                      if (
                        !(await confirm({
                          title: "Xóa hội thoại?",
                          message:
                            "Tin nhắn và snapshot của hội thoại này sẽ bị xóa. Báo cáo nghiên cứu được giữ nguyên; bạn có thể xuất lịch sử trước.",
                          accept: "Xóa hội thoại",
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        await jsonApi(`/api/ai/conversations/${conversation}`, {
                          method: "DELETE",
                        });
                        setConversation("");
                        setMessages([]);
                        await loadConversations();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    })()
                  }
                >
                  Xóa hội thoại
                </button>
              </div>
            )}
          </div>
        </details>
        <button
          type="button"
          className="chat-new"
          disabled={
            busy || active || session.status === "closed" || !conversation
          }
          onClick={newConversation}
        >
          + Hội thoại mới
        </button>
      </header>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ai-notice" role="status">
          {notice}
        </p>
      )}
      <div
        className="chat-messages"
        role="log"
        aria-label="Tin nhắn"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <button
          hidden={!cursor}
          onClick={() => {
            const gen = generation.current;
            void jsonApi<{ items: Message[]; nextCursor: number | null }>(
              `/api/ai/conversations/${conversation}/messages?before=${cursor}`,
            )
              .then((data) => {
                if (gen !== generation.current) return;
                setMessages((prev) => [...data.items, ...prev]);
                setCursor(data.nextCursor);
              })
              .catch((e) => {
                if (gen === generation.current) setError(e.message);
              });
          }}
        >
          Tải tin nhắn cũ
        </button>
        {!messages.length && (
          <div className="chat-empty chat-welcome">
            <span className="chat-avatar large" aria-hidden="true">
              ✦
            </span>
            <h3>Hôm nay bạn muốn tìm hiểu gì trong dữ liệu?</h3>
            <p>
              Hỏi về báo cáo đang mở, các dòng đang chọn hoặc cả project. Câu
              trả lời trích dẫn từng dòng dữ liệu để bạn kiểm chứng.
            </p>
            <div className="ai-actions suggestion-chips">
              {(
                preview?.suggestions ?? [
                  "Tóm tắt kết quả báo cáo",
                  "Tìm các dòng có sai số ppm lớn",
                  "So sánh các báo cáo đã chọn",
                ]
              ).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setQuestion(q);
                    textarea.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, index) => (
          <article key={m.id} className={`chat-message ${m.role}`}>
            <header>
              {m.role === "assistant" && (
                <span className="chat-avatar" aria-hidden="true">
                  ✦
                </span>
              )}
              {m.role === "assistant" && `${m.provider_name} · ${m.model_id}`}
              {m.role === "user" &&
                m.attachments?.some((x) => x.type === "mirror_plot") && (
                  <small>
                    📈 kèm mirror plot
                    {m.attachments[0].compoundName
                      ? ` · ${m.attachments[0].compoundName}`
                      : ""}
                  </small>
                )}
              {m.role === "assistant" && m.status !== "completed" && (
                <small>
                  {(
                    {
                      queued: "đang chờ",
                      running: "đang trả lời",
                      completed: "hoàn tất",
                      failed: "lỗi",
                      cancelled: "đã dừng",
                      interrupted: "gián đoạn",
                    } as Record<string, string>
                  )[m.status] ?? m.status}
                  {m.status === "queued" && m.queue_position
                    ? ` · vị trí ${m.queue_position} trong hàng đợi`
                    : ""}
                </small>
              )}
            </header>
            <div
              className={`chat-content${m.role === "assistant" ? " md" : ""}`}
            >
              {m.role === "assistant" && m.content ? (
                <Markdown
                  text={m.content}
                  citations={m.citations}
                  onCite={(c) =>
                    void onOpenReport(
                      c.reportId!,
                      c.rowId ? [c.rowId] : undefined,
                    ).catch((e) => setError(e.message))
                  }
                />
              ) : (
                m.content || (
                  <span className="chat-thinking" role="status">
                    {["queued", "running"].includes(m.state) && (
                      <span className="typing-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                    {m.tool_progress?.length
                      ? `Đang tra dữ liệu: ${m.tool_progress.map((t) => TOOL_LABELS[t] ?? t).join(" → ")}…`
                      : "Đang xử lý dữ liệu…"}
                  </span>
                )
              )}
            </div>
            {m.role === "assistant" &&
              m.citations?.some((c) => c.status !== "ok") && (
                <div className="citation-warning">
                  <p>
                    ⚠ {m.citations.filter((c) => c.status === "invalid").length}{" "}
                    mã nguồn không tồn tại,{" "}
                    {m.citations.filter((c) => c.status === "unseen").length} mã
                    trỏ tới dòng AI chưa được xem. Hãy kiểm tra lại các số liệu
                    liên quan.
                  </p>
                  <div className="ai-actions">
                    <button
                      type="button"
                      onClick={() =>
                        checked[m.request_id]
                          ? setChecked(({ [m.request_id]: _, ...rest }) => rest)
                          : void loadCitations(m.request_id).catch((e) =>
                              setError(e.message),
                            )
                      }
                    >
                      {checked[m.request_id] ? "Ẩn số liệu gốc" : "Kiểm chứng"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || active || isArchived}
                      onClick={() =>
                        void recheck(m.request_id).catch((e) =>
                          setError(e.message),
                        )
                      }
                    >
                      Nhờ AI kiểm tra lại
                    </button>
                  </div>
                  {checked[m.request_id] && (
                    <div className="md-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Mã</th>
                            <th>Nguồn</th>
                            <th>Hợp chất</th>
                            <th>ppm</th>
                            <th>RT</th>
                            <th>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checked[m.request_id]
                            .filter((c) => c.status !== "ok")
                            .map((c) => (
                              <tr key={c.ref}>
                                <td>{c.ref}</td>
                                <td>
                                  {c.status === "invalid"
                                    ? "Không tồn tại"
                                    : `${c.reportTitle ?? ""}${c.row?.sourceTsvRow ? ` · dòng TSV ${c.row.sourceTsvRow}` : ""}`}
                                </td>
                                <td>{c.row?.compoundName ?? "—"}</td>
                                <td>{c.row?.ppm ?? "—"}</td>
                                <td>{c.row?.rt ?? "—"}</td>
                                <td>{c.row?.status ?? "—"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      <small>
                        Số liệu lấy từ snapshot của lượt trả lời này (không gọi
                        AI).
                      </small>
                    </div>
                  )}
                </div>
              )}
            {m.error_message && m.role === "assistant" && (
              <p className="ai-error">{m.error_message}</p>
            )}
            {m.role === "assistant" && m.finish_reason === "length" && (
              <p className="ai-truncated">
                Câu trả lời bị cắt do chạm giới hạn output của model.
              </p>
            )}
            {m.role === "assistant" && (
              <div className="ai-actions msg-actions">
                <button onClick={() => void sources(m.request_id)}>
                  Nguồn dữ liệu & token
                </button>
                {m.status === "completed" && m.content && (
                  <button
                    type="button"
                    onClick={() =>
                      void saveAsDraft(m.request_id).catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    Dùng làm nháp thảo luận
                  </button>
                )}
                {m.status === "completed" && m.content && (
                  <>
                    <button
                      type="button"
                      className="feedback-button"
                      aria-pressed={m.feedback_rating === 1}
                      aria-label="Câu trả lời hữu ích"
                      onClick={() =>
                        void rate(m, 1).catch((e) => setError(e.message))
                      }
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      className="feedback-button"
                      aria-pressed={m.feedback_rating === -1}
                      aria-label="Câu trả lời chưa đúng"
                      onClick={() =>
                        m.feedback_rating === -1
                          ? void rate(m, -1).catch((e) => setError(e.message))
                          : setFeedbackDraft((prev) => ({
                              ...prev,
                              [m.request_id]: prev[m.request_id] ?? "",
                            }))
                      }
                    >
                      👎
                    </button>
                  </>
                )}
                {m.finish_reason === "length" &&
                  index === messages.length - 1 && (
                    <button
                      disabled={busy || active || isArchived}
                      onClick={() => void send(CONTINUE_PROMPT)}
                    >
                      Tiếp tục
                    </button>
                  )}
                {["failed", "cancelled", "interrupted"].includes(m.status) && (
                  <button
                    disabled={busy || active || isArchived}
                    onClick={() => {
                      const userMessage = [...messages.slice(0, index)]
                        .reverse()
                        .find((x) => x.role === "user");
                      if (userMessage)
                        void send(userMessage.content, m.request_id);
                      else setError("Hãy tải tin nhắn cũ để tìm câu hỏi gốc.");
                    }}
                  >
                    Thử lại
                  </button>
                )}
              </div>
            )}
            {/* The question and its answer share request_id; feedback belongs to the answer. */}
            {m.role === "assistant" && m.request_id in feedbackDraft && (
              <form
                className="feedback-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rate(m, -1, feedbackDraft[m.request_id])
                    .then(() =>
                      setFeedbackDraft(
                        ({ [m.request_id]: _, ...rest }) => rest,
                      ),
                    )
                    .catch((err) => setError(err.message));
                }}
              >
                <label>
                  Điều gì chưa đúng? (không bắt buộc)
                  <textarea
                    maxLength={1000}
                    value={feedbackDraft[m.request_id]}
                    onChange={(e) =>
                      setFeedbackDraft((prev) => ({
                        ...prev,
                        [m.request_id]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className="ai-actions">
                  <button type="submit">Gửi góp ý</button>
                  <button
                    type="button"
                    onClick={() =>
                      setFeedbackDraft(({ [m.request_id]: _, ...rest }) => rest)
                    }
                  >
                    Hủy
                  </button>
                </div>
              </form>
            )}
            {m.role === "assistant" && sourceInfo[m.request_id] && (
              <details className="chat-sources" open>
                <summary>
                  Nguồn đã dùng · snapshot{" "}
                  {sourceInfo[m.request_id].snapshotId.slice(0, 8)}
                </summary>
                {sourceInfo[m.request_id].sources.map((s) => (
                  <div key={s.reportId}>
                    <button
                      onClick={() =>
                        void onOpenReport(s.reportId, s.rowIds).catch((e) =>
                          setError(e.message),
                        )
                      }
                    >
                      {s.title} · revision {s.revision}
                      {s.rowIds.length ? ` · ${s.rowIds.length} dòng` : ""}
                    </button>
                    <small>
                      Mở báo cáo hiện tại; câu trả lời dùng revision đã ghi.
                    </small>
                  </div>
                ))}
                <small>
                  Ước tính:{" "}
                  {sourceInfo[m.request_id].usage.estimated_cost ??
                    "chưa xác định"}{" "}
                  {sourceInfo[m.request_id].usage.currency ?? ""}. Token:{" "}
                  {sourceInfo[m.request_id].usage.input_tokens ??
                    "không xác định"}{" "}
                  vào /{" "}
                  {sourceInfo[m.request_id].usage.output_tokens ??
                    "không xác định"}{" "}
                  ra
                  {sourceInfo[m.request_id].usage.cached_input_tokens
                    ? ` (provider báo ${sourceInfo[m.request_id].usage.cached_input_tokens} token vào lấy từ cache)`
                    : ""}{" "}
                  · {sourceInfo[m.request_id].toolRuns.length} truy vấn dữ liệu
                </small>
                {sourceInfo[m.request_id].contextInfo && (
                  <small>
                    Dữ liệu khởi tạo:{" "}
                    {sourceInfo[m.request_id].contextInfo!.returnedRows}/
                    {sourceInfo[m.request_id].contextInfo!.examinedRows} dòng
                    {sourceInfo[m.request_id].contextInfo!.truncated
                      ? " · có giới hạn"
                      : ""}
                    . Lịch sử đầy đủ luôn lưu DB; context dùng{" "}
                    {sourceInfo[m.request_id].contextInfo!.historyIncluded} tin
                    nhắn gần nhất,{" "}
                    {sourceInfo[m.request_id].contextInfo!.historyOmitted} tin
                    nhắn cũ được rút gọn hoặc loại khỏi prompt.
                  </small>
                )}
              </details>
            )}
          </article>
        ))}
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        {preview && conversation && (
          <ContextMeter
            preview={preview}
            dismissed={hintDismissed === conversation}
            disabled={busy || active || session.status === "closed"}
            onDismiss={() => setHintDismissed(conversation)}
            onNewChat={newConversation}
          />
        )}
        {!question.trim() &&
          messages.length > 0 &&
          !!preview?.suggestions.length && (
            <div className="ai-actions suggestion-chips">
              {preview.suggestions.map((q) => (
                <button type="button" key={q} onClick={() => setQuestion(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
        <div className={`composer-box${compose ? " is-busy" : ""}`}>
          <textarea
            aria-label="Câu hỏi"
            required
            rows={1}
            maxLength={6000}
            value={question}
            ref={textarea}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line (not while composing IME).
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (canSend) e.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={compose}
            placeholder={
              session.status === "closed"
                ? "Phiên đã đóng"
                : isArchived
                  ? "Hội thoại đã lưu trữ"
                  : "Hỏi về dữ liệu nghiên cứu…"
            }
          />
          {preview?.supportsVision && (
            <label className="ai-check attach-spectrum">
              <input
                type="checkbox"
                checked={attachSpectrum}
                disabled={scope !== "selection" || preview.rows.examined !== 1}
                onChange={(e) => setAttachSpectrum(e.target.checked)}
              />
              Kèm ảnh mirror plot của dòng đang chọn (~{fmtTokens(1100)} token)
            </label>
          )}
          <div className="composer-bar">
            <select
              aria-label="Phạm vi dữ liệu"
              className="composer-scope"
              value={scope}
              disabled={busy || active}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="selection">Dòng đang chọn</option>
              <option value="report">Báo cáo đang mở</option>
              <option value="project">Cả project</option>
            </select>
            {scope === "project" && (
              <details className="composer-pop">
                <summary>
                  {chosenReports.length
                    ? `${chosenReports.length} báo cáo`
                    : "Mọi báo cáo"}
                </summary>
                <fieldset>
                  <legend>Không chọn = toàn project, tối đa 10</legend>
                  {reports.map((r) => (
                    <label key={r.id} className="ai-check">
                      <input
                        type="checkbox"
                        disabled={busy || active}
                        checked={chosenReports.includes(r.id)}
                        onChange={(e) =>
                          setChosenReports((prev) =>
                            e.target.checked
                              ? [...prev, r.id]
                              : prev.filter((id) => id !== r.id),
                          )
                        }
                      />
                      {r.title}
                    </label>
                  ))}
                </fieldset>
              </details>
            )}
            <span className="composer-spacer" />
            {preview && (
              <details
                className={`composer-pop token-preview${preview.fits ? "" : " blocked"}`}
              >
                <summary title="Dự toán token của câu hỏi này">
                  ~{fmtTokens(preview.input)} token
                </summary>
                <div className="composer-pop-body">
                  <p>
                    Vào ~{fmtTokens(preview.input)} · ra tối đa{" "}
                    {fmtTokens(preview.outputMax)} · giữ chỗ ~
                    {fmtTokens(preview.reserve)}
                    {preview.toolRounds && " (+ mỗi vòng công cụ)"}
                  </p>
                  <ul>
                    <li>
                      Hướng dẫn: ~{fmtTokens(preview.breakdown.instructions)}
                    </li>
                    <li>
                      Dữ liệu: ~{fmtTokens(preview.breakdown.data)} ·{" "}
                      {preview.rows.sent}/{preview.rows.examined} dòng
                      {preview.rows.truncated ? " (đã rút gọn)" : ""}
                    </li>
                    <li>
                      Lịch sử: ~{fmtTokens(preview.breakdown.history)} ·{" "}
                      {preview.history.included / 2} lượt gần nhất
                      {preview.history.omitted
                        ? `, ${preview.history.omitted / 2} lượt cũ chỉ còn trích đoạn`
                        : ""}
                    </li>
                    <li>Câu hỏi: ~{fmtTokens(preview.breakdown.question)}</li>
                    {preview.toolRounds && (
                      <li>
                        Mô tả công cụ: ~{fmtTokens(preview.breakdown.tools)}
                      </li>
                    )}
                  </ul>
                  <small>
                    Ước tính{" "}
                    {preview.calibrated
                      ? "đã hiệu chỉnh theo usage thật của model"
                      : "chưa hiệu chỉnh (model chưa có lượt nào có usage)"}
                    ; số thật lấy từ provider sau khi trả lời.
                  </small>
                  {quotas[effectiveProviderId] && (
                    <QuotaMeter quota={quotas[effectiveProviderId]!} />
                  )}
                </div>
              </details>
            )}
            <span className="composer-model">
              <ModelPicker
                providers={providers}
                value={choice}
                defaultLabel={defaultLabel}
                onChange={(v) => {
                  setChoice(v);
                  setNotice("");
                }}
                disabled={busy || active}
              />
            </span>
            {active ? (
              <button
                type="button"
                className="composer-send stop"
                aria-label="Dừng trả lời"
                title="Dừng trả lời"
                onClick={() => {
                  const id =
                    request?.requestId ??
                    messages.find(
                      (m) =>
                        m.role === "assistant" &&
                        ["queued", "running"].includes(m.state),
                    )?.request_id;
                  if (id)
                    void jsonApi<RequestState>(
                      `/api/ai/requests/${id}/cancel`,
                      jsonBody({}),
                    )
                      .then((data) => setRequest(data))
                      .catch((e) => setError(e.message));
                }}
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                className="composer-send"
                aria-label={busy ? "Đang gửi" : "Gửi câu hỏi"}
                aria-busy={busy}
                title="Gửi (Enter)"
                disabled={!canSend}
              >
                {busy ? <span className="send-spinner" /> : "↑"}
              </button>
            )}
          </div>
        </div>
        {preview && !preview.fits && (
          <p className="ai-error">{preview.reason}</p>
        )}
        {!preview && previewError && conversation && (
          <small className="composer-note">{previewError}</small>
        )}
        <small className="composer-note">
          {preview
            ? `Sẽ gửi ${
                scope === "selection" &&
                preview.rows.examined <
                  preview.reports.reduce((n, r) => n + r.rowCount, 0)
                  ? `${preview.rows.examined} dòng đang chọn`
                  : scope === "project"
                    ? `${preview.reports.length} báo cáo trong project`
                    : "toàn báo cáo"
              } (${preview.reports.map((r) => `${r.title} r${r.revision}`).join(", ")}) tới ${effectiveProvider?.name ?? "provider"}. `
            : "Dữ liệu trong phạm vi đã chọn được gửi tới provider khi bạn hỏi. "}
          {choice && choice !== defaultChoice ? (
            <>
              Model mới áp dụng từ câu hỏi tiếp theo ·{" "}
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void rememberModel()}
              >
                Ghi nhớ cho phiên
              </button>
            </>
          ) : (
            "AI có thể sai: hãy kiểm chứng trích dẫn trước khi dùng."
          )}
        </small>
      </form>
    </section>
  );
}
