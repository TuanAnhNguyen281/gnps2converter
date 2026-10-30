import { useEffect, useRef, useState } from "react";
import { jsonApi, jsonBody } from "../api";
import { useAccount } from "../Account";
import { useConfirm } from "../Ui";
import { ChatPanel, type ChatContext } from "./ChatPanel";
import { ModelPicker, firstModel, modelLabel } from "./AiSettings";
import { ReviewQueue } from "./ReviewQueue";
import { DiscussionDraft } from "./DiscussionDraft";
import type { Project, Provider, Report, Session } from "./types";
export function ResearchWorkspace({
  reportId,
  beforeSend,
  onOpenReport,
  onCreateReport,
  onSettings,
  compact = false,
  contextKey,
}: {
  reportId: string | null;
  beforeSend: (options?: { save?: boolean }) => Promise<ChatContext>;
  onOpenReport: (id: string, rowIds?: string[]) => Promise<void>;
  onCreateReport: (projectId: string) => Promise<void>;
  onSettings: () => void;
  compact?: boolean;
  contextKey?: unknown;
}) {
  const { user } = useAccount(),
    confirm = useConfirm(),
    storageKey = `gnps-research-${user.id}`;
  const [projects, setProjects] = useState<Project[]>([]),
    [initialLoading, setInitialLoading] = useState(true),
    // Bumped by "Tải lại" when the project list failed to load.
    [loadAttempt, setLoadAttempt] = useState(0),
    [loadFailed, setLoadFailed] = useState(false),
    [projectLoading, setProjectLoading] = useState(false),
    [projectId, setProjectId] = useState(""),
    [sessions, setSessions] = useState<Session[]>([]),
    [sessionId, setSessionId] = useState(""),
    [reports, setReports] = useState<Report[]>([]),
    [unassigned, setUnassigned] = useState<Report[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [goal, setGoal] = useState(""),
    [fromReport, setFromReport] = useState(""),
    // The sidebar is a drawer on narrow screens.
    [navOpen, setNavOpen] = useState(false),
    // The question that opens a new session, and the session it opened.
    [opening, setOpening] = useState(""),
    [firstQuestion, setFirstQuestion] = useState<{
      sessionId: string;
      text: string;
      model: string;
    } | null>(null),
    // "providerId|modelId" for the opening question; "" uses the default.
    [openingModel, setOpeningModel] = useState(""),
    [projectDefaultModel, setProjectDefaultModel] = useState(""),
    [attachId, setAttachId] = useState(""),
    [modelChoice, setModelChoice] = useState("");
  const generation = useRef(0),
    restored = useRef(false),
    session = sessions.find((s) => s.id === sessionId),
    project = projects.find((p) => p.id === projectId);
  async function allReports() {
    let cursor: string | null = null;
    const list: Report[] = [];
    do {
      const page: { items: Report[]; nextCursor: string | null } =
        await jsonApi(
          `/api/reports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
      list.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return list;
  }
  useEffect(() => {
    let alive = true;
    setInitialLoading(true);
    setLoadFailed(false);
    setError("");
    restored.current = false;
    void Promise.all([
      jsonApi<Project[]>("/api/projects"),
      jsonApi<Provider[]>("/api/ai/providers"),
      allReports(),
    ])
      .then(([p, providers, list]) => {
        if (!alive) return;
        setProjects(p);
        setProviders(providers);
        setUnassigned(list.filter((r) => !r.project_id));
        let stored: any = {};
        try {
          stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        } catch {}
        const assigned = list.find((r) => r.id === reportId)?.project_id;
        const id =
          assigned ??
          (p.some((x) => x.id === stored.projectId)
            ? stored.projectId
            : (p.find((x) => !x.archived_at)?.id ?? ""));
        setProjectId(id);
        if (stored.projectId === id) setSessionId(stored.sessionId ?? "");
        restored.current = true;
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setInitialLoading(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [reportId, storageKey, loadAttempt]);
  async function loadProject(id: string) {
    const [r, s] = await Promise.all([
      jsonApi<Report[]>(`/api/projects/${id}/reports`),
      jsonApi<Session[]>(`/api/projects/${id}/research-sessions`),
    ]);
    return { r, s };
  }
  useEffect(() => {
    const gen = ++generation.current;
    setReports([]);
    setSessions([]);
    setModelChoice("");
    setError("");
    if (!projectId) {
      setProjectLoading(false);
      return;
    }
    setProjectLoading(true);
    void loadProject(projectId)
      .then(({ r, s }) => {
        if (gen !== generation.current) return;
        setReports(r);
        setSessions(s);
        setSessionId((prev) =>
          s.some((x) => x.id === prev)
            ? prev
            : (s.find((x) => x.status === "active")?.id ?? s[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (gen === generation.current) setError(e.message);
      })
      .finally(() => {
        if (gen === generation.current) setProjectLoading(false);
      });
  }, [projectId]);
  // The model a new session would use: the project's default, else the account's.
  useEffect(() => {
    if (!projectId || sessionId) return;
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
          rows.find((s) => s.scope === "project" && s.scope_id === projectId) ??
          rows.find((s) => s.scope === "account");
        setProjectDefaultModel(
          setting
            ? `${setting.provider_id}|${setting.model_id}`
            : firstModel(providers),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, sessionId, providers]);
  useEffect(() => {
    if (!restored.current || !projectId || !sessionId) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ projectId, sessionId }),
      );
    } catch {}
  }, [projectId, sessionId, storageKey]);
  useEffect(() => {
    if (
      !session ||
      !reportId ||
      !reports.some((r) => r.id === reportId) ||
      session.active_report_id === reportId
    )
      return;
    void jsonApi<Session>(
      `/api/research-sessions/${session.id}`,
      jsonBody({ activeReportId: reportId }, "PATCH"),
    )
      .then((s) =>
        setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x))),
      )
      .catch((e) => setError(e.message));
  }, [sessionId, reportId, reports]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startSession() {
    const text = opening.trim();
    if (!project || !text) return;
    await act(async () => {
      const s = await jsonApi<Session>(
        `/api/projects/${project.id}/research-sessions`,
        jsonBody({
          question: text,
          // The open report if it belongs here, else the newest one.
          activeReportId: reports.some((r) => r.id === reportId)
            ? reportId
            : reports[0]?.id,
        }),
      );
      setSessions((prev) => [s, ...prev]);
      setFirstQuestion({ sessionId: s.id, text, model: openingModel });
      setSessionId(s.id);
      setOpening("");
      const titleModel = openingModel || projectDefaultModel,
        [providerId, modelId] = titleModel.split("|");
      // Best effort; the session keeps its draft title on any failure.
      void jsonApi<Session>(
        `/api/research-sessions/${s.id}/auto-title`,
        jsonBody({
          question: text,
          ...(titleModel ? { providerId, modelId } : {}),
        }),
      )
        .then((titled) =>
          setSessions((prev) =>
            prev.map((x) => (x.id === titled.id ? titled : x)),
          ),
        )
        .catch(() => {});
    });
  }
  async function context(options?: { save?: boolean }) {
    const current = await beforeSend(options);
    if (current.reportId && !reports.some((r) => r.id === current.reportId)) {
      if (compact)
        throw new Error(
          "Báo cáo đang mở chưa thuộc project này. Hãy thêm vào project hoặc mở báo cáo của project.",
        );
      current.reportId = null;
      current.selectedRowIds = [];
    }
    if (!current.reportId && session?.active_report_id)
      return {
        reportId: session.active_report_id,
        revision:
          reports.find((r) => r.id === session.active_report_id)?.revision ?? 0,
        selectedRowIds: session.view_state.selectedRowIds ?? [],
      };
    return current;
  }
  if (initialLoading)
    return (
      <section className="research-page">
        <h1>Nghiên cứu cùng AI</h1>
        <p role="status">Đang tải project và dữ liệu phiên…</p>
      </section>
    );
  return (
    <section
      className={`research-page research-app${compact ? " research-compact" : ""}${navOpen ? " nav-open" : ""}`}
    >
      <aside className="research-nav" aria-label="Project và phiên">
        <div className="nav-head">
          <strong>Nghiên cứu cùng AI</strong>
          <button
            type="button"
            className="nav-icon"
            title="Cài đặt AI"
            aria-label="Cài đặt AI"
            onClick={onSettings}
          >
            ⚙
          </button>
          <button
            type="button"
            className="nav-icon nav-close"
            aria-label="Đóng danh sách"
            onClick={() => setNavOpen(false)}
          >
            ✕
          </button>
        </div>
        <button
          type="button"
          className="nav-new"
          disabled={busy || !project || !!project.archived_at}
          onClick={() => {
            setSessionId("");
            setNavOpen(false);
          }}
        >
          <span aria-hidden="true">＋</span> Phiên mới
        </button>
        <label className="nav-project">
          <span>Project</span>
          <select
            aria-label="Chọn project"
            value={projectId}
            disabled={busy}
            onChange={(e) => {
              setSessionId("");
              setProjectId(e.target.value);
            }}
          >
            <option value="">Chọn project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived_at ? " · lưu trữ" : ""}
              </option>
            ))}
          </select>
        </label>
        <details className="nav-section" open={!projects.length}>
          <summary>Tạo project</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const p = await jsonApi<Project>(
                  "/api/projects",
                  jsonBody({
                    ...(name.trim() ? { name } : {}),
                    researchGoal: goal,
                    ...(fromReport ? { fromReportId: fromReport } : {}),
                  }),
                );
                setProjects((prev) => [p, ...prev]);
                setUnassigned((prev) =>
                  prev.filter((r) => r.id !== fromReport),
                );
                setSessionId("");
                setProjectId(p.id);
                setName("");
                setGoal("");
                setFromReport("");
              });
            }}
          >
            <label>
              Từ báo cáo
              <select
                aria-label="Tạo project từ báo cáo"
                value={fromReport}
                onChange={(e) => setFromReport(e.target.value)}
              >
                <option value="">Không — đặt tên thủ công</option>
                {unassigned.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tên project
              <input
                required={!fromReport}
                maxLength={160}
                value={name}
                placeholder={
                  unassigned.find((r) => r.id === fromReport)?.title ?? ""
                }
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Mục tiêu nghiên cứu
              <textarea
                maxLength={4000}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              Tạo project
            </button>
          </form>
        </details>
        {projectLoading && (
          <p className="nav-status" role="status">
            Đang tải báo cáo và phiên…
          </p>
        )}
        {project && !projectLoading && (
          <>
            <div className="nav-group-label">Phiên gần đây</div>
            <div className="nav-sessions" role="list">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  role="listitem"
                  className={`nav-session${s.id === sessionId ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="nav-session-open"
                    disabled={busy}
                    title={s.title}
                    onClick={() => {
                      setSessionId(s.id);
                      setNavOpen(false);
                    }}
                  >
                    {s.title}
                    {s.status === "closed" && <small> · đã đóng</small>}
                  </button>
                  {s.id === sessionId && (
                    <details className="nav-more">
                      <summary aria-label="Tùy chọn phiên">⋯</summary>
                      <div className="nav-menu">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const title = window.prompt("Tên phiên", s.title);
                              if (!title?.trim()) return;
                              const updated = await jsonApi<Session>(
                                `/api/research-sessions/${s.id}`,
                                jsonBody({ title }, "PATCH"),
                              );
                              setSessions((prev) =>
                                prev.map((x) =>
                                  x.id === updated.id ? updated : x,
                                ),
                              );
                            })
                          }
                        >
                          Đổi tên phiên
                        </button>
                        <button
                          type="button"
                          disabled={busy || !!project.archived_at}
                          onClick={() =>
                            void act(async () => {
                              if (
                                s.status === "active" &&
                                !(await confirm({
                                  title: "Đóng phiên nghiên cứu?",
                                  message:
                                    "Lịch sử vẫn được giữ và có thể mở phiên lại.",
                                  accept: "Đóng phiên",
                                }))
                              )
                                return;
                              const updated = await jsonApi<Session>(
                                `/api/research-sessions/${s.id}`,
                                jsonBody(
                                  {
                                    status:
                                      s.status === "active"
                                        ? "closed"
                                        : "active",
                                  },
                                  "PATCH",
                                ),
                              );
                              setSessions((prev) =>
                                prev.map((x) =>
                                  x.id === updated.id ? updated : x,
                                ),
                              );
                            })
                          }
                        >
                          {s.status === "active" ? "Đóng phiên" : "Mở phiên"}
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              ))}
              {!sessions.length && (
                <p className="nav-status">
                  Chưa có phiên. Đặt câu hỏi để bắt đầu.
                </p>
              )}
            </div>
            <details className="nav-section" open={!reports.length}>
              <summary>Báo cáo trong project ({reports.length})</summary>
              {reports.map((r) => (
                <button
                  type="button"
                  className={`research-report ${reportId === r.id ? "active" : ""}`}
                  key={r.id}
                  onClick={() =>
                    void act(async () => {
                      if (session) {
                        const s = await jsonApi<Session>(
                          `/api/research-sessions/${session.id}`,
                          jsonBody({ activeReportId: r.id }, "PATCH"),
                        );
                        setSessions((prev) =>
                          prev.map((x) => (x.id === s.id ? s : x)),
                        );
                      }
                      await onOpenReport(r.id);
                    })
                  }
                >
                  {r.title}
                  <small>
                    {r.row_count} dòng · revision {r.revision}
                  </small>
                </button>
              ))}
              {!reports.length && (
                <p className="nav-status">Chưa có báo cáo.</p>
              )}
              <button
                type="button"
                disabled={busy || !!project.archived_at}
                onClick={() => void act(() => onCreateReport(projectId))}
              >
                Nhập báo cáo mới
              </button>
              <label>
                Thêm báo cáo có sẵn
                <select
                  aria-label="Báo cáo chưa thuộc project"
                  value={attachId}
                  onChange={(e) => setAttachId(e.target.value)}
                >
                  <option value="">Chọn báo cáo</option>
                  {unassigned.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !attachId || !!project.archived_at}
                onClick={() =>
                  void act(async () => {
                    await jsonApi(
                      `/api/projects/${projectId}/reports`,
                      jsonBody({ reportId: attachId }),
                    );
                    const { r } = await loadProject(projectId);
                    setReports(r);
                    setUnassigned((prev) =>
                      prev.filter((r) => r.id !== attachId),
                    );
                    setAttachId("");
                  })
                }
              >
                Thêm vào project
              </button>
            </details>
            {reportId && (
              <details className="nav-section">
                <summary>Công cụ báo cáo</summary>
                <ReviewQueue
                  reportId={reportId}
                  revision={reports.find((r) => r.id === reportId)?.revision}
                  onOpenRow={(rowId) =>
                    void onOpenReport(reportId, [rowId]).catch((e) =>
                      setError(e.message),
                    )
                  }
                />
                <DiscussionDraft reportId={reportId} />
              </details>
            )}
            <details className="nav-section">
              <summary>Cài đặt project</summary>
              <p className="research-goal">
                {project.research_goal || "Chưa có mục tiêu nghiên cứu."}
              </p>
              <div className="ai-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const newName = window.prompt(
                        "Tên project",
                        project.name,
                      );
                      if (!newName?.trim()) return;
                      const newGoal = window.prompt(
                        "Mục tiêu nghiên cứu",
                        project.research_goal,
                      );
                      if (newGoal === null) return;
                      const updated = await jsonApi<Project>(
                        `/api/projects/${project.id}`,
                        jsonBody(
                          { name: newName, researchGoal: newGoal },
                          "PATCH",
                        ),
                      );
                      setProjects((prev) =>
                        prev.map((p) => (p.id === updated.id ? updated : p)),
                      );
                    })
                  }
                >
                  Sửa project
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const p = await jsonApi<Project>(
                        `/api/projects/${project.id}`,
                        jsonBody({ archived: !project.archived_at }, "PATCH"),
                      );
                      setProjects((prev) =>
                        prev.map((x) => (x.id === p.id ? p : x)),
                      );
                    })
                  }
                >
                  {project.archived_at ? "Mở lại" : "Lưu trữ"}
                </button>
              </div>
              <label className="ai-check lookup-toggle">
                <input
                  type="checkbox"
                  checked={!!project.allow_external_lookup}
                  disabled={busy || !!project.archived_at}
                  onChange={(e) => {
                    const allow = e.target.checked;
                    void act(async () => {
                      const p = await jsonApi<Project>(
                        `/api/projects/${project.id}`,
                        jsonBody({ allowExternalLookup: allow }, "PATCH"),
                      );
                      setProjects((prev) =>
                        prev.map((x) => (x.id === p.id ? p : x)),
                      );
                    });
                  }}
                />
                Cho AI tra cứu PubChem/NPClassifier
              </label>
              <small className="lookup-note">
                Khi bật, InChIKey/SMILES của dòng được hỏi sẽ gửi tới PubChem và
                NPClassifier (GNPS2); dữ liệu báo cáo khác không gửi đi.
              </small>
              <label>
                Model mặc định cho project/phiên
                <ModelPicker
                  providers={providers}
                  value={modelChoice}
                  onChange={setModelChoice}
                />
              </label>
              <div className="ai-actions">
                {(["project", "session"] as const).map((scope) => (
                  <button
                    type="button"
                    key={scope}
                    disabled={
                      busy || !modelChoice || (scope === "session" && !session)
                    }
                    onClick={() =>
                      void act(async () => {
                        const [providerId, modelId] = modelChoice.split("|");
                        await jsonApi(
                          "/api/ai/settings",
                          jsonBody({
                            scope,
                            scopeId:
                              scope === "project" ? projectId : sessionId,
                            providerId,
                            modelId,
                          }),
                        );
                      })
                    }
                  >
                    Lưu cho {scope === "project" ? "project" : "phiên"}
                  </button>
                ))}
              </div>
            </details>
          </>
        )}
      </aside>
      <button
        type="button"
        className="nav-scrim"
        aria-label="Đóng danh sách"
        onClick={() => setNavOpen(false)}
      />
      <div className="research-stage">
        <button
          type="button"
          className="nav-toggle"
          aria-label="Mở danh sách project và phiên"
          onClick={() => setNavOpen(true)}
        >
          ☰ {project?.name ?? "Chọn project"}
        </button>
        {error && (
          <p className="ai-error" role="alert">
            {error}
            {loadFailed && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setLoadAttempt((n) => n + 1)}
                >
                  Tải lại
                </button>
              </>
            )}
          </p>
        )}
        {session && project && !project.archived_at ? (
          <ChatPanel
            key={session.id}
            session={session}
            reports={reports}
            providers={providers}
            compact={compact}
            contextKey={contextKey}
            beforeSend={context}
            onOpenReport={onOpenReport}
            initialQuestion={
              firstQuestion?.sessionId === session.id
                ? firstQuestion.text
                : undefined
            }
            initialModel={
              firstQuestion?.sessionId === session.id
                ? firstQuestion.model
                : undefined
            }
          />
        ) : project && !project.archived_at && !projectLoading ? (
          <section className="ai-chat" aria-label="Phiên nghiên cứu mới">
            <header className="chat-topbar">
              <div className="chat-switcher">
                <span className="chat-title">Phiên mới</span>
                <small>{project.name}</small>
              </div>
            </header>
            <div className="chat-messages">
              <div className="chat-empty chat-welcome">
                <span className="chat-avatar large" aria-hidden="true">
                  ✦
                </span>
                <h3>Bạn muốn tìm hiểu gì trong “{project.name}”?</h3>
                <p>
                  Đặt câu hỏi để bắt đầu: phiên được tạo tự động và AI đặt tên
                  theo nội dung câu hỏi.
                </p>
                {!!reports.length && (
                  <div className="ai-actions suggestion-chips">
                    {[
                      "Tóm tắt kết quả báo cáo",
                      "Dòng nào nên duyệt lại trước?",
                      "Tìm các dòng có sai số ppm lớn",
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setOpening(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void startSession();
              }}
            >
              <div className="composer-box">
                <textarea
                  aria-label="Câu hỏi"
                  required
                  rows={2}
                  maxLength={6000}
                  value={opening}
                  disabled={busy || !reports.length}
                  onChange={(e) => setOpening(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    reports.length
                      ? "Hỏi về dữ liệu nghiên cứu…"
                      : "Thêm báo cáo vào project trước khi hỏi"
                  }
                />
                <div className="composer-bar">
                  <span className="composer-spacer" />
                  <span className="composer-model">
                    <ModelPicker
                      providers={providers}
                      value={openingModel}
                      defaultLabel={modelLabel(providers, projectDefaultModel)}
                      onChange={setOpeningModel}
                      disabled={busy}
                    />
                  </span>
                  <button
                    type="submit"
                    className="composer-send"
                    aria-label={busy ? "Đang tạo phiên" : "Gửi câu hỏi"}
                    aria-busy={busy}
                    title="Gửi (Enter)"
                    disabled={busy || !opening.trim() || !reports.length}
                  >
                    {busy ? <span className="send-spinner" /> : "↑"}
                  </button>
                </div>
              </div>
              <small className="composer-note">
                Có thể đổi model và phạm vi dữ liệu trong phiên sau câu hỏi đầu
                tiên.
              </small>
            </form>
          </section>
        ) : (
          <section className="ai-chat chat-placeholder">
            <div className="chat-empty chat-welcome">
              <span className="chat-avatar large" aria-hidden="true">
                ✦
              </span>
              <h3>
                {project?.archived_at
                  ? "Project đã lưu trữ"
                  : "Bắt đầu một phiên nghiên cứu"}
              </h3>
              <p>
                {project?.archived_at
                  ? "Mở lại project trong Cài đặt project để tiếp tục hỏi."
                  : "Chọn project ở thanh bên (hoặc tạo từ một báo cáo) rồi đặt câu hỏi; phiên chat được tạo tự động."}
              </p>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
