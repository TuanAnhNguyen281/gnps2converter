import { lazy, Suspense, useState } from "react";
import { Brand, Icon, ThemeButton, useTheme } from "./Ui";
const SciFiBackground = lazy(() => import("./SciFiBackground"));
export type Entry = "task" | "files" | "reports";

export function Dashboard({
  signedIn,
  onEnter,
}: {
  signedIn: boolean;
  onEnter: (entry: Entry, taskUrl?: string) => void;
}) {
  const { theme } = useTheme();
  const [taskUrl, setTaskUrl] = useState("");
  return (
    <div className="app-shell landing-shell public-dashboard">
      <header className="topbar landing-topbar liquid-glass">
        <Brand />
        <nav className="steps" aria-label="Tiến trình">
          <span className="active">
            <i>1</i>
            <span className="step-label step-label-full">Nhập dữ liệu</span>
            <span className="step-label step-label-short">Nhập</span>
          </span>
          <b />
          <span>
            <i>2</i>
            <span className="step-label step-label-full">Đối chiếu &amp; hiệu chỉnh</span>
            <span className="step-label step-label-short">Rà soát</span>
          </span>
          <b />
          <span>
            <i>3</i>
            <span className="step-label">Lưu &amp; xuất</span>
          </span>
        </nav>
        <div className="top-actions">
          <button
            className="ui-button dashboard-account"
            onClick={() => onEnter("reports")}
          >
            {signedIn ? "Báo cáo của tôi" : "Đăng nhập"}
          </button>
          <ThemeButton />
        </div>
      </header>
      <main className="landing-page">
        <div className="landing-scrim" />
        <div className="landing-vignette" />
        <Suspense fallback={null}>
          <SciFiBackground theme={theme} />
        </Suspense>
        <div className="landing-content">
          <p className="landing-tagline">
            MASS SPECTROMETRY ANALYTICAL WORKSPACE
          </p>
          <h1>
            <span className="headline-gradient headline-gradient-cyan">
              Đối sánh
            </span>{" "}
            dữ liệu{" "}
            <span className="headline-gradient headline-gradient-spectrum">
              phổ khối
            </span>
            . <br />
            Tạo báo cáo{" "}
            <span className="headline-gradient headline-gradient-precision">
              chuẩn xác
            </span>
            .
          </h1>
          <section
            className="landing-import liquid-glass dashboard-entry"
            aria-label="Bắt đầu nhập dữ liệu"
          >
            <form
              className="dashboard-command"
              onSubmit={(event) => {
                event.preventDefault();
                onEnter("task", taskUrl.trim());
              }}
            >
              <label className="dashboard-task-field">
                <Icon name="link" />
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  aria-label="Link GNPS2"
                  value={taskUrl}
                  onChange={(event) => setTaskUrl(event.currentTarget.value)}
                  placeholder="Dán link GNPS2 để bắt đầu"
                />
              </label>
              <button className="ui-button primary dashboard-task-action" type="submit">
                <Icon name="link" />
                <span>GNPS2 Task</span>
                <Icon name="arrow" />
              </button>
              <span className="dashboard-command-divider" aria-hidden="true" />
              <button
                className="ui-button dashboard-files-action"
                type="button"
                onClick={() => onEnter("files")}
              >
                <Icon name="file" />
                <span>Tải TSV + XLSX</span>
              </button>
            </form>
            <small className="dashboard-auth-note">
              <Icon name={signedIn ? "check" : "lock"} />
              {signedIn
                ? "Báo cáo được lưu riêng trong tài khoản của bạn."
                : "Đăng nhập ở bước tiếp theo để nhập dữ liệu và lưu báo cáo."}
            </small>
          </section>
        </div>
      </main>
    </div>
  );
}
