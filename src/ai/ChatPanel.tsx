import { useEffect, useRef, useState } from "react";
import { apiUrl, jsonApi, jsonBody, apiFetch } from "../api";
import { ModelPicker } from "./AiSettings";
import { useConfirm } from "../Ui";
import type {
  Conversation,
  Message,
  Provider,
  Report,
  RequestState,
  Session,
} from "./types";
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
}: {
  session: Session;
  reports: Report[];
  providers: Provider[];
  beforeSend: () => Promise<ChatContext>;
  onOpenReport: (id: string, rowIds?: string[]) => Promise<void>;
  compact?: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [conversationSearch, setConversationSearch] = useState(""),
    [defaultChoice, setDefaultChoice] = useState(""),
    [conversation, setConversation] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [question, setQuestion] = useState(""),
    [choice, setChoice] = useState(""),
    [scope, setScope] = useState<"selection" | "report" | "project">(
      "selection",
    ),
    [chosenReports, setChosenReports] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState<RequestState | null>(null),
    [sourceInfo, setSourceInfo] = useState<Record<string, RequestState>>({});
  const generation = useRef(0),
    stream = useRef<EventSource | null>(null),
    sending = useRef(false),
    pending = useRef<{ id: string; signature: string } | null>(null),
    polling = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          setting ? `${setting.provider_id}|${setting.model_id}` : "",
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
    setChoice("");
    setChosenReports([]);
    pending.current = null;
    void jsonApi<Conversation[]>(
      `/api/research-sessions/${session.id}/conversations`,
    )
      .then((rows) => {
        if (alive) {
          setConversations(rows);
          setConversation(rows.find((c) => !c.archived_at)?.id ?? "");
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
  async function newConversation() {
    if (sending.current) return;
    setBusy(true);
    setError("");
    try {
      const c = await jsonApi<Conversation>(
        `/api/research-sessions/${session.id}/conversations`,
        jsonBody({}),
      );
      setConversations((prev) => [c, ...prev]);
      setConversation(c.id);
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(text: string, retryOf?: string) {
    if (
      sending.current ||
      active ||
      !conversation ||
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
      const reportIds =
        scope === "project"
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
      if (scope === "selection" && context.selectedRowIds.length > 300)
        throw new Error("Chọn tối đa 300 dòng hoặc chuyển sang toàn báo cáo.");
      const expectedRevisions = Object.fromEntries(
        reports
          .filter((r) => reportIds.includes(r.id))
          .map((r) => [r.id, r.revision]),
      );
      if (context.reportId && reportIds.includes(context.reportId))
        expectedRevisions[context.reportId] = context.revision;
      const [providerId, modelId] = choice.split("|"),
        payload = {
          message: text,
          ...(retryOf ? { retryOf } : {}),
          ...(choice ? { providerId, modelId } : {}),
          context: {
            reportIds,
            scope,
            selectedRowIds: scope === "selection" ? context.selectedRowIds : [],
            viewState: context.viewState,
            expectedRevisions,
          },
        },
        signature = JSON.stringify(payload);
      if (!pending.current || pending.current.signature !== signature)
        pending.current = { id: crypto.randomUUID(), signature };
      const r = await jsonApi<{ requestId: string }>(
        `/api/ai/conversations/${conversation}/messages`,
        jsonBody({ clientRequestId: pending.current.id, ...payload }),
      );
      pending.current = null;
      if (generation.current !== gen) return;
      setQuestion("");
      const loaded = await loadMessages(conversation);
      if (generation.current !== gen) return;
      setMessages(loaded.items);
      setCursor(loaded.nextCursor);
      observe(r.requestId, gen, conversation);
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
    ?.archived_at;
  return (
    <section className="ai-chat" aria-label="Chat nghiên cứu">
      <div className="ai-card-heading">
        <div>
          <h2>Trợ lý nghiên cứu</h2>
          <small>
            {session.title} ·{" "}
            {session.status === "closed"
              ? "phiên đã đóng"
              : "dữ liệu theo phiên"}
          </small>
        </div>
        <button
          disabled={busy || active || session.status === "closed"}
          onClick={() => void newConversation()}
        >
          Hội thoại mới
        </button>
      </div>
      <details className="chat-context-options" open={!compact}>
        <summary>Phạm vi dữ liệu & model</summary>
        <div className="ai-chat-controls">
          <label>
            Tìm hội thoại
            <input
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="Tên hội thoại"
            />
          </label>
          <label>
            Hội thoại
            <select
              aria-label="Lịch sử hội thoại"
              value={conversation}
              disabled={busy}
              onChange={(e) => {
                pending.current = null;
                setConversation(e.target.value);
              }}
            >
              <option value="">Tạo hội thoại mới để bắt đầu</option>
              {conversations
                .filter(
                  (c) =>
                    c.id === conversation ||
                    c.title
                      .toLowerCase()
                      .includes(conversationSearch.toLowerCase()),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.archived_at ? " · lưu trữ" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Model
            <ModelPicker
              providers={providers}
              value={choice}
              onChange={setChoice}
              disabled={busy || active}
            />
          </label>
          <label>
            Phạm vi
            <select
              aria-label="Phạm vi dữ liệu"
              value={scope}
              disabled={busy || active}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="selection">Các dòng đang chọn</option>
              <option value="report">Báo cáo đang mở</option>
              <option value="project">Các báo cáo trong project</option>
            </select>
          </label>
          {scope === "project" && (
            <fieldset>
              <legend>
                Chọn báo cáo (không chọn = toàn project, tối đa 10)
              </legend>
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
          )}
        </div>
      </details>
      <small className="ai-disclosure">
        Model hiệu lực:{" "}
        {effectiveProvider
          ? `${effectiveProvider.name} · ${effectiveModelId}`
          : "Chưa cấu hình"}
        . Khi gửi, dữ liệu trong phạm vi trên được chuyển tới provider đã chọn.
        Không có dòng chọn thì lấy tổng hợp báo cáo; AI nêu rõ dữ liệu bị giới
        hạn.
      </small>
      {conversation && (
        <div className="ai-actions">
          <button onClick={() => void rename()}>Đổi tên</button>
          <button onClick={() => void exportChat("markdown")}>
            Xuất Markdown
          </button>
          <button onClick={() => void exportChat("json")}>Xuất JSON</button>
          <button
            disabled={busy || active}
            onClick={() =>
              void (async () => {
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
          <button
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
        </div>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-messages" role="log" aria-label="Tin nhắn">
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
          <div className="chat-empty">
            <h3>Hỏi về dữ liệu nghiên cứu của bạn</h3>
            <p>Tạo hội thoại, chọn model và đặt câu hỏi về báo cáo.</p>
            <div className="ai-actions">
              {[
                "Tóm tắt kết quả báo cáo",
                "Tìm các dòng có sai số ppm lớn",
                "So sánh các báo cáo đã chọn",
              ].map((q) => (
                <button key={q} onClick={() => setQuestion(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, index) => (
          <article key={m.id} className={`chat-message ${m.role}`}>
            <header>
              {m.role === "user" ? "Bạn" : `${m.provider_name} · ${m.model_id}`}{" "}
              {m.role === "assistant" && (
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
                </small>
              )}
            </header>
            <div className="chat-content">
              {m.content || "Đang xử lý dữ liệu…"}
            </div>
            {m.error_message && m.role === "assistant" && (
              <p className="ai-error">{m.error_message}</p>
            )}
            {m.role === "assistant" && (
              <div className="ai-actions">
                <button onClick={() => void sources(m.request_id)}>
                  Nguồn dữ liệu & token
                </button>
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
                  ra · {sourceInfo[m.request_id].toolRuns.length} truy vấn dữ
                  liệu
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
        <label>
          Câu hỏi
          <textarea
            required
            maxLength={6000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={
              busy || active || isArchived || session.status === "closed"
            }
            placeholder="Nhập câu hỏi về báo cáo…"
          />
        </label>
        <div className="ai-actions">
          <button
            disabled={
              !conversation ||
              busy ||
              active ||
              isArchived ||
              session.status === "closed" ||
              !question.trim()
            }
            type="submit"
          >
            {busy ? "Đang gửi…" : "Gửi câu hỏi"}
          </button>
          {active && (
            <button
              type="button"
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
              Dừng trả lời
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
