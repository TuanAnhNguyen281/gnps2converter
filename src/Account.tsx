import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiUrl, jsonApi, jsonBody, setCsrf } from "./api";
import { Brand, Icon, ThemeButton, useTheme } from "./Ui";
import { Dashboard, type Entry } from "./Dashboard";
const SciFiBackground = lazy(() => import("./SciFiBackground"));
export interface User {
  id: string;
  email: string;
  displayName: string;
  hasPassword: boolean;
  googleLinked?: boolean;
}
const Context = createContext<{
  user: User;
  googleEnabled: boolean;
  logout: () => Promise<void>;
  initialEntry: Entry;
  initialTaskUrl: string;
  goHome: () => void;
}>({
  user: null as unknown as User,
  googleEnabled: false,
  logout: async () => {},
  initialEntry: "reports",
  initialTaskUrl: "",
  goHome: () => {},
});
export const useAccount = () => useContext(Context);
export function AccountProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [entry, setEntry] = useState<Entry>(() => {
    const stored = sessionStorage.getItem("gnps-entry");
    return stored === "task" || stored === "files" ? stored : "reports";
  });
  const [initialTaskUrl, setInitialTaskUrl] = useState(
    () => sessionStorage.getItem("gnps-task-url") ?? "",
  );
  const [dashboard, setDashboard] = useState(
    () => !sessionStorage.getItem("gnps-entry"),
  );
  function goHome() {
    sessionStorage.removeItem("gnps-entry");
    sessionStorage.removeItem("gnps-task-url");
    setInitialTaskUrl("");
    setDashboard(true);
  }
  function enter(next: Entry, nextTaskUrl = "") {
    setEntry(next);
    const pendingTaskUrl = next === "task" ? nextTaskUrl.trim() : "";
    setInitialTaskUrl(pendingTaskUrl);
    if (pendingTaskUrl) sessionStorage.setItem("gnps-task-url", pendingTaskUrl);
    else sessionStorage.removeItem("gnps-task-url");
    if (user) sessionStorage.removeItem("gnps-entry");
    else sessionStorage.setItem("gnps-entry", next);
    setDashboard(false);
  }
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(false),
    [mode, setMode] = useState<"login" | "register">("login"),
    [busy, setBusy] = useState(false),
    [google, setGoogle] = useState(false);
  async function bootstrap() {
    setChecking(true);
    setConnectionError(false);
    try {
      const init = await jsonApi<{ csrf: string; googleEnabled: boolean }>(
        "/api/auth/csrf",
      );
      setCsrf(init.csrf);
      setGoogle(init.googleEnabled);
      try {
        const me = await jsonApi<{ user: User; csrf: string }>("/api/auth/me");
        setUser(me.user);
        sessionStorage.removeItem("gnps-entry");
        setCsrf(me.csrf);
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e;
      }
    } catch (e) {
      setConnectionError(true);
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void bootstrap();
    const expired = () => {
      setUser(null);
      setCsrf("");
      setError("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.");
    };
    window.addEventListener("gnps-session-expired", expired);
    const params = new URLSearchParams(location.search);
    if (params.has("authError")) {
      setError(params.get("authError")!);
      history.replaceState(null, "", location.pathname);
    }
    return () => window.removeEventListener("gnps-session-expired", expired);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConnectionError(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const answer = await jsonApi<{ user: User; csrf: string }>(
        `/api/auth/${mode}`,
        jsonBody(values),
      );
      setCsrf(answer.csrf);
      setUser(answer.user);
      sessionStorage.removeItem("gnps-entry");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await jsonApi("/api/auth/logout", jsonBody({}));
    setUser(null);
    goHome();
    setCsrf("");
    setError("");
    void bootstrap();
  }
  if (dashboard) return <Dashboard signedIn={!!user} onEnter={enter} />;
  if (user)
    return (
      <Context.Provider
        value={{
          user,
          googleEnabled: google,
          logout,
          initialEntry: entry,
          initialTaskUrl,
          goHome,
        }}
      >
        {children}
      </Context.Provider>
    );
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <div className="auth-story-atmosphere" aria-hidden="true">
          <div className="landing-scrim" />
          <div className="landing-vignette" />
          <Suspense fallback={null}>
            <SciFiBackground theme={theme} />
          </Suspense>
        </div>
        <Brand />
        <div className="auth-story-copy">
          <span className="eyebrow">KHÔNG GIAN PHÂN TÍCH GNPS2</span>
          <h1>
            Từ dữ liệu phổ khối
            <br />
            đến <em>báo cáo hoàn chỉnh.</em>
          </h1>
          <p>
            Đối chiếu, hiệu chỉnh và lưu trữ kết quả nghiên cứu trong một không
            gian của riêng bạn.
          </p>
          <div className="auth-sample" aria-hidden="true">
            <div className="sample-top">
              <span>
                <Icon name="grid" /> Tổng quan phân tích
              </span>
              <i />
            </div>
            <div className="sample-spectrum">
              {[
                18, 30, 24, 63, 38, 83, 45, 29, 98, 55, 28, 72, 37, 22, 59, 33,
                17, 41, 26, 15,
              ].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="sample-caption">
              <span>m/z</span>
              <span>GNPS2 · Library Matches</span>
            </div>
            <div className="sample-bottom">
              <span>
                <Icon name="check" /> Dữ liệu có tổ chức
              </span>
              <span>
                <Icon name="check" /> Báo cáo riêng tư
              </span>
            </div>
          </div>
          <ul className="auth-benefits">
            <li>
              <Icon name="reports" />
              <div>
                <strong>Lưu và tiếp tục bất cứ lúc nào</strong>
                <span>
                  Kết quả, chỉnh sửa và file nguồn trong cùng báo cáo.
                </span>
              </div>
            </li>
            <li>
              <Icon name="download" />
              <div>
                <strong>Sẵn sàng cho nghiên cứu</strong>
                <span>Xuất Word và Excel từ dữ liệu đã hiệu chỉnh.</span>
              </div>
            </li>
          </ul>
        </div>
        <small className="auth-story-footer">
          GNPS2 CONVERTER · Analytical workspace
        </small>
      </aside>
      <section className="auth-form-side">
        <div className="auth-top">
          <button className="ui-button" onClick={goHome}>
            ← Về dashboard
          </button>
          <ThemeButton />
        </div>
        <div className="auth-form-card">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="eyebrow">CHÀO MỪNG ĐẾN GNPS2</span>
          <h2>
            {checking
              ? "Đang kết nối…"
              : mode === "login"
                ? "Đăng nhập tài khoản"
                : "Bắt đầu với tài khoản mới"}
          </h2>
          <p>
            {mode === "login"
              ? "Tiếp tục công việc với các báo cáo đã lưu của bạn."
              : "Tạo không gian riêng để quản lý dữ liệu và báo cáo."}
          </p>
          {checking ? (
            <div className="auth-checking" role="status">
              <span className="spinner" /> Đang kiểm tra phiên đăng nhập…
            </div>
          ) : (
            <>
              <button
                className="ui-button google-login"
                disabled={!google || busy}
                onClick={() => location.assign(apiUrl("/api/auth/google"))}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="google-mark"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 5-1 6.7-2.4l-3.3-2.5a6 6 0 0 1-9-3.2H3v2.6A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 6Z"
                  />
                </svg>{" "}
                Tiếp tục với Google
              </button>
              {!google && (
                <small className="field-hint">
                  Đăng nhập Google chưa sẵn sàng. Bạn có thể sử dụng email.
                </small>
              )}
              <div className="auth-divider">
                <span>hoặc sử dụng email</span>
              </div>
              <form key={mode} onSubmit={submit} className="ui-form">
                {mode === "register" && (
                  <label>
                    Họ và tên
                    <input
                      name="displayName"
                      placeholder="Tên hiển thị của bạn"
                      required
                      maxLength={80}
                      autoComplete="name"
                      disabled={busy}
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    placeholder="ban@example.com"
                    required
                    maxLength={254}
                    autoComplete="username"
                    disabled={busy}
                  />
                </label>
                <label>
                  Mật khẩu
                  <div className="password-field">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        mode === "register"
                          ? "Ít nhất 12 ký tự"
                          : "Nhập mật khẩu của bạn"
                      }
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={
                        showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                      }
                      aria-pressed={showPassword}
                    >
                      <Icon name="eye" />
                    </button>
                  </div>
                  {mode === "register" && (
                    <small className="field-hint">
                      Sử dụng ít nhất 12 ký tự để bảo vệ tài khoản.
                    </small>
                  )}
                </label>
                {error && (
                  <div className="ui-alert" role="alert">
                    <Icon name="alert" />
                    <div>
                      {error}
                      {connectionError && (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            void bootstrap();
                          }}
                        >
                          Kiểm tra lại kết nối
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <button
                  className="ui-button primary auth-submit"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="spinner" /> Đang xử lý…
                    </>
                  ) : (
                    <>
                      {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
                      <Icon name="arrow" />
                    </>
                  )}
                </button>
              </form>
              <p className="auth-mode-switch">
                {mode === "login"
                  ? "Bạn chưa có tài khoản?"
                  : "Bạn đã có tài khoản?"}{" "}
                <button
                  disabled={busy}
                  onClick={() => {
                    setMode(mode === "login" ? "register" : "login");
                    setError("");
                    setShowPassword(false);
                  }}
                >
                  {mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}
                </button>
              </p>
            </>
          )}
          <div className="auth-footnote">
            <Icon name="check" />
            <span>
              Dữ liệu được lưu riêng theo tài khoản.
              <br />
              Khôi phục mật khẩu qua email chưa được hỗ trợ.
            </span>
          </div>
        </div>
        <small className="auth-credit">
          GNPS2 Converter · Không gian nghiên cứu của bạn
        </small>
      </section>
    </main>
  );
}
