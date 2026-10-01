import { useEffect, useRef, useState } from "react";
import { jsonApi, jsonBody } from "../api";
import { useAccount } from "../Account";
import { useConfirm } from "../Ui";
import { ChatPanel, type ChatContext } from "./ChatPanel";
import { ModelPicker } from "./AiSettings";
import type { Project, Provider, Report, Session } from "./types";
export function ResearchWorkspace({
  reportId,
  beforeSend,
  onOpenReport,
  onCreateReport,
  onSettings,
  compact = false,
}: {
  reportId: string | null;
  beforeSend: () => Promise<ChatContext>;
  onOpenReport: (id: string, rowIds?: string[]) => Promise<void>;
  onCreateReport: (projectId: string) => Promise<void>;
  onSettings: () => void;
  compact?: boolean;
}) {
  const { user } = useAccount(),
    confirm = useConfirm(),
    storageKey = `gnps-research-${user.id}`;
  const [projects, setProjects] = useState<Project[]>([]),
    [initialLoading, setInitialLoading] = useState(true),
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
    [sessionName, setSessionName] = useState(""),
    [attachId, setAttachId] = useState(""),
    [modelChoice, setModelChoice] = useState(""),
    [search, setSearch] = useState("");
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
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setInitialLoading(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [reportId, storageKey]);
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
  async function context() {
    const current = await beforeSend();
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
    <section className={`research-page ${compact ? "research-compact" : ""}`}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT & PHIÊN</span>
          <h1>Nghiên cứu cùng AI</h1>
          {!compact && (
            <p>
              Gom báo cáo theo project, tiếp tục phiên và hỏi trực tiếp trên dữ
              liệu đã lưu.
            </p>
          )}
        </div>
        <button onClick={onSettings}>Cài đặt AI</button>
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className={`research-layout ${session ? "has-session" : ""}`}>
        <aside className="research-sidebar ai-card">
          <label>
            Project
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
          <details open={!projects.length}>
            <summary>Tạo project</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const p = await jsonApi<Project>(
                    "/api/projects",
                    jsonBody({ name, researchGoal: goal }),
                  );
                  setProjects((prev) => [p, ...prev]);
                  setProjectId(p.id);
                  setName("");
                  setGoal("");
                });
              }}
            >
              <label>
                Tên project
                <input
                  required
                  maxLength={160}
                  value={name}
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
          {projectLoading && <p role="status">Đang tải báo cáo và phiên…</p>}
          {project && !projectLoading && (
            <>
              <p className="research-goal">
                {project.research_goal || "Chưa có mục tiêu nghiên cứu."}
              </p>
              <div className="ai-actions">
                <button
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
              <label>
                Phiên nghiên cứu
                <select
                  aria-label="Chọn phiên nghiên cứu"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Chọn phiên</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.status === "closed" ? " · đã đóng" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const s = await jsonApi<Session>(
                      `/api/projects/${projectId}/research-sessions`,
                      jsonBody({ title: sessionName }),
                    );
                    setSessions((prev) => [s, ...prev]);
                    setSessionId(s.id);
                    setSessionName("");
                  });
                }}
              >
                <label>
                  Tên phiên mới
                  <input
                    required
                    maxLength={160}
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                  />
                </label>
                <button disabled={busy || !!project.archived_at}>
                  Tạo phiên
                </button>
              </form>
              {session && (
                <div className="ai-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const title = window.prompt("Tên phiên", session.title);
                        if (!title?.trim()) return;
                        const s = await jsonApi<Session>(
                          `/api/research-sessions/${session.id}`,
                          jsonBody({ title }, "PATCH"),
                        );
                        setSessions((prev) =>
                          prev.map((x) => (x.id === s.id ? s : x)),
                        );
                      })
                    }
                  >
                    Đổi tên phiên
                  </button>
                  <button
                    disabled={busy || !!project.archived_at}
                    onClick={() =>
                      void act(async () => {
                        if (
                          session.status === "active" &&
                          !(await confirm({
                            title: "Đóng phiên nghiên cứu?",
                            message:
                              "Lịch sử vẫn được giữ và có thể mở phiên lại.",
                            accept: "Đóng phiên",
                          }))
                        )
                          return;
                        const s = await jsonApi<Session>(
                          `/api/research-sessions/${session.id}`,
                          jsonBody(
                            {
                              status:
                                session.status === "active"
                                  ? "closed"
                                  : "active",
                            },
                            "PATCH",
                          ),
                        );
                        setSessions((prev) =>
                          prev.map((x) => (x.id === s.id ? s : x)),
                        );
                      })
                    }
                  >
                    {session.status === "active" ? "Đóng phiên" : "Mở phiên"}
                  </button>
                </div>
              )}
              <h3>Báo cáo trong project</h3>
              {reports.map((r) => (
                <button
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
              {!reports.length && <p>Chưa có báo cáo.</p>}
              <button
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
              <details>
                <summary>Model theo project/phiên</summary>
                <ModelPicker
                  providers={providers}
                  value={modelChoice}
                  onChange={setModelChoice}
                />
                <div className="ai-actions">
                  {(["project", "session"] as const).map((scope) => (
                    <button
                      key={scope}
                      disabled={
                        busy ||
                        !modelChoice ||
                        (scope === "session" && !session)
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
        <div className="research-main">
          {session && project && !project.archived_at ? (
            <ChatPanel
              key={session.id}
              session={session}
              reports={reports}
              providers={providers}
              compact={compact}
              beforeSend={context}
              onOpenReport={onOpenReport}
            />
          ) : (
            <div className="ai-card chat-empty">
              <h2>
                {project?.archived_at
                  ? "Project đã lưu trữ"
                  : "Bắt đầu một phiên nghiên cứu"}
              </h2>
              <p>
                Chọn project, thêm báo cáo và tạo phiên để lưu các cuộc trò
                chuyện cùng dữ liệu.
              </p>
            </div>
          )}
          {!compact && (
            <section className="ai-card">
              <label>
                Tìm project
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tên hoặc mục tiêu nghiên cứu"
                />
              </label>
              <div className="project-list">
                {projects
                  .filter((p) =>
                    `${p.name} ${p.research_goal}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      className={p.id === projectId ? "active" : ""}
                      key={p.id}
                      onClick={() => {
                        setSessionId("");
                        setProjectId(p.id);
                      }}
                    >
                      <strong>{p.name}</strong>
                      <small>
                        {p.research_goal || "Chưa ghi mục tiêu"}
                        {p.archived_at ? " · lưu trữ" : ""}
                      </small>
                    </button>
                  ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
