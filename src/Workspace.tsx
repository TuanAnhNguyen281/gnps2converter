import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "./Account";
import { apiFetch, apiUrl, jsonApi, jsonBody, setCsrf } from "./api";
import { Brand, EmptyState, Icon, ThemeButton, useConfirm } from "./Ui";
import type { SavedResult } from "./useReport";
export type WorkspacePage =
  "dashboard" | "reports" | "upload" | "results" | "account";
interface ReportItem {
  id: string;
  title: string;
  row_count: number;
  updated_at: string;
}
export interface StoredAsset {
  id: string;
  name: string;
  kind: string;
  bytes: number;
  state: string;
  rowId?: string;
  revision?: number;
}
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const initial = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((s) => s[0])
    .join("")
    .toUpperCase() || "U";
export function WorkspaceShell({
  page,
  onNavigate,
  onOpenReport,
  children,
  activeReportId,
  reportsRefresh,
  engineStatus,
  dirty,
  saveNow,
  locked,
}: {
  page: WorkspacePage;
  onNavigate: (page: WorkspacePage) => Promise<void>;
  onOpenReport: (id: string) => Promise<void>;
  children: ReactNode;
  activeReportId: string | null;
  reportsRefresh: number;
  engineStatus: string;
  dirty: () => boolean;
  saveNow: () => Promise<void>;
  locked: boolean;
}) {
  const { user, logout } = useAccount(),
    ask = useConfirm(),
    menu = useRef<HTMLDialogElement>(null),
    [error, setError] = useState(""),
    [leaving, setLeaving] = useState(false),
    [navigating, setNavigating] = useState(false),
    [sidebarExpanded, setSidebarExpanded] = useState(false),
    [reports, setReports] = useState<ReportItem[]>([]),
    [reportsLoading, setReportsLoading] = useState(true),
    [reportsError, setReportsError] = useState("");
  const reportsRequest = useRef(0);
  const titles = {
    dashboard: "Dashboard",
    reports: "Báo cáo của tôi",
    upload: "Tạo báo cáo mới",
    results: "Chi tiết báo cáo",
    account: "Tài khoản",
  };
  async function go(next: WorkspacePage) {
    if (navigating || locked || leaving) return;
    setNavigating(true);
    setError("");
    try {
      await onNavigate(next);
      menu.current?.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNavigating(false);
    }
  }
  async function openSidebarReport(id: string) {
    if (navigating || locked || leaving) return;
    if (id === activeReportId && page === "results") {
      menu.current?.close();
      return;
    }
    setNavigating(true);
    setError("");
    try {
      if (dirty()) await saveNow();
      await onOpenReport(id);
      menu.current?.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNavigating(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function loadReports() {
      const requestId = ++reportsRequest.current;
      if (!reports.length) setReportsLoading(true);
      setReportsError("");
      try {
        const loaded: ReportItem[] = [];
        let cursor: string | null = null;
        do {
          const cursorQuery: string = cursor
            ? `?cursor=${encodeURIComponent(cursor)}`
            : "";
          const pageResult: {
            items: ReportItem[];
            nextCursor: string | null;
          } = await jsonApi<{
            items: ReportItem[];
            nextCursor: string | null;
          }>(`/api/reports${cursorQuery}`);
          loaded.push(...pageResult.items);
          cursor = pageResult.nextCursor;
        } while (cursor && active && reportsRequest.current === requestId);
        if (active && reportsRequest.current === requestId)
          setReports(loaded);
      } catch (e) {
        if (active && reportsRequest.current === requestId)
          setReportsError((e as Error).message || "Không tải được báo cáo.");
      } finally {
        if (active && reportsRequest.current === requestId)
          setReportsLoading(false);
      }
    }
    const refreshOnFocus = () => void loadReports();
    void loadReports();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      reportsRequest.current++;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [page, reportsRefresh]);
  async function exit() {
    if (
      dirty() &&
      !(await ask({
        title: "Lưu trước khi đăng xuất?",
        message:
          "Báo cáo có thay đổi chưa lưu. Hệ thống sẽ lưu trước khi kết thúc phiên đăng nhập.",
        accept: "Lưu và đăng xuất",
      }))
    )
      return;
    setLeaving(true);
    try {
      await saveNow();
      await logout();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLeaving(false);
    }
  }
  const navigation = (navigationId: string) => (
    <>
      <div className="sidebar-brand">
        <div className="sidebar-brand-identity">
          <Brand />
          <span className="workspace-tag">WORKSPACE</span>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-expanded={sidebarExpanded}
          aria-controls={navigationId}
          aria-label={
            sidebarExpanded
              ? "Thu gọn thanh điều hướng"
              : "Mở rộng thanh điều hướng"
          }
          title={
            sidebarExpanded
              ? "Thu gọn thanh điều hướng"
              : "Mở rộng thanh điều hướng"
          }
          onClick={() => setSidebarExpanded((expanded) => !expanded)}
        >
          <Icon name="arrow" />
        </button>
      </div>
      <nav
        id={navigationId}
        className="workspace-nav"
        aria-label="Điều hướng chính"
      >
        {(
          [
            { id: "dashboard", icon: "grid", label: "Dashboard" },
            { id: "reports", icon: "reports", label: "Báo cáo của tôi" },
            { id: "upload", icon: "plus", label: "Tạo báo cáo" },
            { id: "account", icon: "user", label: "Tài khoản" },
          ] as const
        ).map((item) => (
          <button
            className={page === item.id ? "active" : ""}
            aria-current={page === item.id ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            key={item.id}
            onClick={() => void go(item.id)}
            disabled={locked || leaving || navigating}
          >
            <Icon name={item.icon} />
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
        {(reports.length > 0 || reportsLoading || reportsError) && (
          <>
            <span className="nav-section-label">ĐANG LÀM VIỆC</span>
            {reports.map((report) => {
              const active =
                page === "results" && report.id === activeReportId;
              return (
                <button
                  className={
                    active ? "active current-report" : "current-report"
                  }
                  aria-current={active ? "page" : undefined}
                  aria-label={report.title}
                  title={`${report.title} · ${dateLabel(report.updated_at)}`}
                  key={report.id}
                  onClick={() => void openSidebarReport(report.id)}
                  disabled={locked || leaving || navigating}
                >
                  <Icon name="file" />
                  <span className="nav-label">{report.title}</span>
                </button>
              );
            })}
            {!reports.length && reportsLoading && (
              <span className="nav-report-state" role="status">
                Đang tải báo cáo…
              </span>
            )}
            {!reports.length && reportsError && (
              <span className="nav-report-state" role="status" title={reportsError}>
                Không tải được báo cáo
              </span>
            )}
          </>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-help">
          <Icon name="check" />
          <span className="nav-label">
            Dữ liệu riêng tư
            <br />
            <small>Chỉ tài khoản của bạn truy cập</small>
          </span>
        </div>
        <button
          className="sidebar-profile"
          aria-label={`Tài khoản ${user.displayName}`}
          title={`${user.displayName} · ${user.email}`}
          onClick={() => void go("account")}
          disabled={locked || navigating || leaving}
        >
          <span className="avatar">{initial(user.displayName)}</span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.email}</small>
          </span>
        </button>
        <button
          className="logout-button"
          aria-label="Đăng xuất"
          title="Đăng xuất"
          onClick={() => void exit()}
          disabled={leaving || locked || navigating}
        >
          <Icon name="logout" />
          <span className="nav-label">
            {leaving ? "Đang đăng xuất…" : "Đăng xuất"}
          </span>
        </button>
      </div>
    </>
  );
  return (
    <div
      className={`workspace-shell${sidebarExpanded ? " sidebar-expanded" : ""}`}
    >
      <a href="#workspace-main" className="skip-link">
        Đến nội dung chính
      </a>
      <aside className="workspace-sidebar" aria-label="Thanh điều hướng workspace">
        {navigation("workspace-sidebar-navigation")}
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button
            className="ui-button icon-button mobile-menu-button"
            onClick={() => menu.current?.showModal()}
            aria-label="Mở điều hướng"
          >
            <Icon name="menu" />
          </button>
          <div className="workspace-breadcrumb">
            <span>Workspace</span>
            <i>/</i>
            <strong>{titles[page]}</strong>
          </div>
          <div className="workspace-top-actions">
            <span className={`connection-pill ${engineStatus}`} role="status">
              <i />
              {engineStatus === "ready"
                ? "Đã kết nối"
                : engineStatus === "checking"
                  ? "Đang kết nối"
                  : "Mất kết nối"}
            </span>
            <ThemeButton />
            <button
              className="avatar top-avatar"
              onClick={() => void go("account")}
              aria-label="Mở tài khoản"
              disabled={locked || navigating || leaving}
            >
              {initial(user.displayName)}
            </button>
          </div>
        </header>
        {error && (
          <div className="shell-alert ui-alert" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Đóng thông báo">
              <Icon name="close" />
            </button>
          </div>
        )}
        <main id="workspace-main" className="workspace-main">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>GNPS2 Converter</span>
          <span>Analytical workspace · TuanAnhNguyen</span>
        </footer>
      </div>
      <dialog
        ref={menu}
        className="mobile-navigation"
        aria-label="Điều hướng workspace"
      >
        <button
          className="ui-button icon-button menu-close"
          onClick={() => menu.current?.close()}
          aria-label="Đóng điều hướng"
        >
          <Icon name="close" />
        </button>
        {navigation("mobile-sidebar-navigation")}
      </dialog>
    </div>
  );
}
export function ReportLibrary({
  onOpen,
  onCreate,
  onDeleted,
}: {
  onOpen: (r: SavedResult) => Promise<void>;
  onCreate: () => void;
  onDeleted: (id: string) => void;
}) {
  const [items, setItems] = useState<ReportItem[]>([]),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [opening, setOpening] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const request = useRef(0),
    ask = useConfirm();
  async function list(next = false) {
    const ticket = ++request.current;
    setBusy(true);
    setError("");
    try {
      const answer = await jsonApi<{
        items: ReportItem[];
        nextCursor: string | null;
      }>(
        `/api/reports?search=${encodeURIComponent(search)}${next && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (ticket !== request.current) return;
      setItems((current) =>
        next ? [...current, ...answer.items] : answer.items,
      );
      setCursor(answer.nextCursor);
      setQuery(search);
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    request.current++;
    setBusy(true);
    const timer = setTimeout(() => void list(), 250);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [search]);
  async function open(id: string) {
    setOpening(id);
    setError("");
    try {
      await onOpen(await jsonApi<SavedResult>(`/api/reports/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  async function remove(item: ReportItem) {
    if (
      !(await ask({
        title: "Xóa báo cáo này?",
        message: `“${item.title}” sẽ bị xóa cùng các file không còn dùng. Thao tác này không thể hoàn tác.`,
        accept: "Xóa báo cáo",
        danger: true,
      }))
    )
      return;
    setOpening(item.id);
    try {
      await jsonApi(`/api/reports/${item.id}`, { method: "DELETE" });
      onDeleted(item.id);
      await list();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  return (
    <section className="library-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KHÔNG GIAN NGHIÊN CỨU</span>
          <h1>Báo cáo của tôi</h1>
          <p>Tất cả kết quả phân tích, file nguồn và bản xuất của bạn.</p>
        </div>
        <button
          className="ui-button primary"
          onClick={onCreate}
          disabled={!!opening}
        >
          <Icon name="plus" />
          Tạo báo cáo mới
        </button>
      </div>
      <div className="library-banner">
        <div className="banner-icon">
          <Icon name="grid" />
        </div>
        <div>
          <strong>Tiếp tục từ nơi bạn đã dừng</strong>
          <p>Mở báo cáo để hiệu chỉnh kết quả hoặc xuất bản Word và Excel.</p>
        </div>
        <span className="privacy-badge">
          <Icon name="check" /> Riêng tư
        </span>
      </div>
      <div className="library-card">
        <div className="library-toolbar">
          <label className="ui-search">
            <Icon name="search" />
            <input
              aria-label="Tìm báo cáo"
              placeholder="Tìm theo tên báo cáo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Xóa tìm kiếm">
                <Icon name="close" />
              </button>
            )}
          </label>
          <span>
            {busy ? "Đang tải…" : `Đã hiển thị ${items.length} báo cáo`}
          </span>
        </div>
        {error && (
          <div className="ui-alert" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
            <button className="ui-button" onClick={() => void list()}>
              Thử lại
            </button>
          </div>
        )}
        {busy && !items.length ? (
          <div
            className="library-skeleton"
            role="status"
            aria-label="Đang tải báo cáo"
          >
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <i />
                <span />
                <b />
              </div>
            ))}
          </div>
        ) : !items.length && !error ? (
          <EmptyState
            title={
              query
                ? "Không tìm thấy báo cáo"
                : "Báo cáo đầu tiên bắt đầu từ đây"
            }
            description={
              query
                ? "Thử một từ khóa khác hoặc xóa tìm kiếm."
                : "Nhập link GNPS2 hoặc tải TSV và XLSX để tạo báo cáo của bạn."
            }
            action={
              <button
                className="ui-button primary"
                onClick={query ? () => setSearch("") : onCreate}
              >
                <Icon name={query ? "search" : "plus"} />
                {query ? "Xóa tìm kiếm" : "Tạo báo cáo mới"}
              </button>
            }
          />
        ) : (
          <>
            <div className="library-columns">
              <span>BÁO CÁO</span>
              <span>SỐ DÒNG</span>
              <span>CẬP NHẬT</span>
              <span />
            </div>
            <div className="library-list" aria-busy={busy || !!opening}>
              {items.map((item) => (
                <article key={item.id}>
                  <button
                    className="library-open"
                    disabled={busy || !!opening}
                    onClick={() => void open(item.id)}
                  >
                    <span className="report-file-icon">
                      <Icon name="file" />
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {opening === item.id
                          ? "Đang xử lý báo cáo…"
                          : "Báo cáo phân tích GNPS2"}
                      </small>
                    </span>
                  </button>
                  <span className="row-count">
                    {item.row_count.toLocaleString("vi-VN")}
                    <small> dòng</small>
                  </span>
                  <time dateTime={item.updated_at}>
                    {dateLabel(item.updated_at)}
                  </time>
                  <div className="library-row-actions">
                    <button
                      className="ui-button"
                      onClick={() => void open(item.id)}
                      disabled={busy || !!opening}
                    >
                      Mở <Icon name="arrow" />
                    </button>
                    <button
                      className="delete-report"
                      onClick={() => void remove(item)}
                      disabled={busy || !!opening}
                      aria-label={`Xóa báo cáo ${item.title}`}
                    >
                      Xóa
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {cursor && (
          <div className="load-more">
            <button
              className="ui-button"
              disabled={busy || !!opening}
              onClick={() => void list(true)}
            >
              {busy ? "Đang tải…" : "Xem thêm báo cáo"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
export function AccountPage() {
  const { user, googleEnabled } = useAccount(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function password(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await jsonApi<{ csrf: string }>(
        "/api/auth/change-password",
        jsonBody(Object.fromEntries(new FormData(form))),
      );
      setCsrf(response.csrf);
      form.reset();
      setMessage("Đã đổi mật khẩu. Các phiên đăng nhập cũ đã được thu hồi.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await jsonApi<{ url: string }>(
        "/api/auth/google/link",
        jsonBody(Object.fromEntries(new FormData(event.currentTarget))),
      );
      location.assign(response.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="account-settings">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THÔNG TIN & BẢO MẬT</span>
          <h1>Tài khoản</h1>
          <p>Quản lý phương thức đăng nhập và bảo vệ dữ liệu của bạn.</p>
        </div>
      </div>
      <div className="profile-card">
        <span className="avatar large-avatar">{initial(user.displayName)}</span>
        <div>
          <h2>{user.displayName}</h2>
          <p>{user.email}</p>
        </div>
        <span className="privacy-badge">
          <Icon name="check" /> Tài khoản cá nhân
        </span>
      </div>
      {message && (
        <div className="ui-success" role="status">
          <Icon name="check" />
          {message}
        </div>
      )}
      {error && (
        <div className="ui-alert" role="alert">
          <Icon name="alert" />
          {error}
        </div>
      )}
      <div className="account-settings-grid">
        <section className="settings-panel">
          <span className="panel-icon">
            <Icon name="user" />
          </span>
          <h2>Bảo mật tài khoản</h2>
          <p>Đổi mật khẩu sẽ đăng xuất các phiên trên thiết bị khác.</p>
          {user.hasPassword ? (
            <form className="ui-form" onSubmit={password}>
              <label>
                Mật khẩu hiện tại
                <input
                  name="oldPassword"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Mật khẩu mới
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Ít nhất 12 ký tự"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </label>
              <button className="ui-button primary" disabled={busy}>
                {busy ? "Đang xử lý…" : "Cập nhật mật khẩu"}
              </button>
            </form>
          ) : (
            <div className="settings-note">
              Bạn đang đăng nhập bằng Google. Tài khoản này chưa sử dụng mật
              khẩu riêng.
            </div>
          )}
        </section>
        <section className="settings-panel">
          <span className="panel-icon">
            <Icon name="link" />
          </span>
          <h2>Đăng nhập bằng Google</h2>
          <p>Liên kết Google để truy cập nhanh vào cùng không gian báo cáo.</p>
          <div className="google-connection">
            <span className="google-letter">G</span>
            <div>
              <strong>Google</strong>
              <small>
                {user.googleLinked ? "Đã liên kết tài khoản" : "Chưa liên kết"}
              </small>
            </div>
            <span className={`ui-badge ${user.googleLinked ? "ready" : ""}`}>
              {user.googleLinked ? "Đã kết nối" : "Chưa kết nối"}
            </span>
          </div>
          {!googleEnabled && !user.googleLinked && (
            <div className="settings-note">
              Đăng nhập Google chưa được cấu hình cho ứng dụng.
            </div>
          )}
          {googleEnabled && user.hasPassword && !user.googleLinked && (
            <form className="ui-form" onSubmit={link}>
              <label>
                Xác nhận mật khẩu
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </label>
              <button className="ui-button" disabled={busy}>
                <Icon name="link" />
                Liên kết Google
              </button>
            </form>
          )}
          <div className="settings-note">
            <Icon name="check" />
            Các báo cáo vẫn thuộc cùng tài khoản khi liên kết.
          </div>
        </section>
      </div>
    </section>
  );
}
const groupFor = (kind: string) =>
  kind === "structure"
    ? "Ảnh cấu trúc"
    : kind.startsWith("export_")
      ? "Bản xuất báo cáo"
      : "File nguồn";
const kindName = (kind: string) =>
  ({
    source_tsv: "TSV nguồn",
    source_xlsx: "Excel nguồn",
    gnps_matches: "Library Matches",
    gnps_graphml: "Network GraphML",
    gnps_mgf: "Spectrum peaks",
    structure: "Ảnh cấu trúc",
    export_docx: "Word",
    export_xlsx: "Excel",
  })[kind] ?? kind;
export function AssetsPanel({
  id,
  refresh,
  onError,
  onRecovered,
}: {
  id: string;
  refresh: number;
  onError: (m: string) => void;
  onRecovered: () => void;
}) {
  const [assets, setAssets] = useState<StoredAsset[]>([]),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [failures, setFailures] = useState<NonNullable<SavedResult["mediaErrors"]>>(
      [],
    ),
    [message, setMessage] = useState("");
  const request = useRef(0);
  async function load() {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const answer = await jsonApi<{
        items: StoredAsset[];
        errors: NonNullable<SavedResult["mediaErrors"]>;
      }>(`/api/reports/${id}/assets`);
      if (ticket !== request.current) return;
      setAssets(answer.items);
      setFailures(answer.errors);
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [id, refresh]);
  async function download(a: StoredAsset) {
    setBusy(a.id);
    setError("");
    try {
      const r = await apiFetch(
        apiUrl(`/api/reports/${id}/assets/${a.id}/download`),
      );
      if (!r.ok) throw new Error((await r.json()).message);
      const u = URL.createObjectURL(await r.blob()),
        link = document.createElement("a");
      link.href = u;
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function retry(
    a: StoredAsset | NonNullable<SavedResult["mediaErrors"]>[number],
    file?: File,
  ) {
    if (!file) return;
    setBusy("retry");
    setError("");
    setMessage("");
    const body = new FormData();
    body.append("file", file);
    const stored = "id" in a;
    if (!stored) {
      body.append("kind", a.kind);
      if (a.rowId) body.append("rowId", a.rowId);
    }
    try {
      const answer = await jsonApi<{ saveWarning?: string }>(
        stored
          ? `/api/reports/${id}/assets/${a.id}/retry`
          : `/api/reports/${id}/assets`,
        { method: "POST", body },
      );
      if (answer.saveWarning) throw new Error(answer.saveWarning);
      setMessage("Đã lưu lại file thành công.");
      onRecovered();
      await load();
    } catch (e) {
      setError((e as Error).message);
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const missing = failures.filter(
    (f) =>
      !assets.some(
        (a) =>
          a.kind === f.kind &&
          (f.rowId ? a.rowId === f.rowId : a.name === f.name),
      ),
  );
  return (
    <section className="assets-page">
      <div className="assets-heading">
        <div>
          <h2>Ảnh và file của báo cáo</h2>
          <p>File nguồn được giữ nguyên. Lưu tối đa 5 bản xuất gần nhất.</p>
        </div>
        <button
          className="ui-button"
          onClick={() => void load()}
          disabled={loading || !!busy}
        >
          Làm mới
        </button>
      </div>
      {error && (
        <div className="ui-alert" role="alert">
          <Icon name="alert" />
          {error}
        </div>
      )}
      {message && (
        <div className="ui-success" role="status">
          <Icon name="check" />
          {message}
        </div>
      )}
      {loading && !assets.length ? (
        <div className="asset-loading" role="status">
          <span className="spinner" />
          Đang tải danh sách file…
        </div>
      ) : !assets.length && !missing.length && !error ? (
        <EmptyState
          icon="file"
          title="Chưa có ảnh hoặc file"
          description="File nguồn, ảnh cấu trúc và bản xuất sẽ xuất hiện tại đây sau khi lưu."
        />
      ) : (
        ["File nguồn", "Ảnh cấu trúc", "Bản xuất báo cáo"].map((group) => {
          const list = assets.filter((a) => groupFor(a.kind) === group),
            errors = missing.filter((f) => groupFor(f.kind) === group);
          return list.length || errors.length ? (
            <div className="asset-group" key={group}>
              <h3>
                {group}
                <span>{list.length + errors.length}</span>
              </h3>
              {list.map((a, index) => (
                <article key={`${a.id}-${index}`}>
                  <span className="asset-icon">
                    <Icon name="file" />
                  </span>
                  <div className="asset-name">
                    <strong>{a.name}</strong>
                    <small>
                      {kindName(a.kind)} ·{" "}
                      {(a.bytes / 1000).toLocaleString("vi-VN", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      KB{a.revision ? ` · Phiên bản ${a.revision}` : ""}
                    </small>
                  </div>
                  <span
                    className={`ui-badge ${a.state === "ready" ? "ready" : "warning"}`}
                  >
                    {a.state === "ready"
                      ? "Đã lưu"
                      : a.state === "pending"
                        ? "Đang lưu"
                        : "Cần lưu lại"}
                  </span>
                  {a.state === "ready" ? (
                    <button
                      className="ui-button"
                      disabled={!!busy}
                      onClick={() => void download(a)}
                    >
                      <Icon name="download" />
                      {busy === a.id ? "Đang tải…" : "Tải về"}
                    </button>
                  ) : a.state === "pending" ? (
                    <small className="field-hint">Đang xử lý…</small>
                  ) : (
                    <label
                      className={`ui-button file-retry ${busy ? "disabled" : ""}`}
                    >
                      Chọn lại file
                      <input
                        type="file"
                        disabled={!!busy}
                        onChange={(e) => {
                          void retry(a, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </article>
              ))}
              {errors.map((f, index) => (
                <article key={`error-${index}`}>
                  <span className="asset-icon warning">
                    <Icon name="alert" />
                  </span>
                  <div className="asset-name">
                    <strong>{f.name}</strong>
                    <small>{f.message}</small>
                  </div>
                  <span className="ui-badge warning">Chưa lưu</span>
                  <label
                    className={`ui-button file-retry ${busy ? "disabled" : ""}`}
                  >
                    Chọn lại file
                    <input
                      type="file"
                      disabled={!!busy}
                      onChange={(e) => {
                        void retry(f, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </article>
              ))}
            </div>
          ) : null;
        })
      )}
    </section>
  );
}
