import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function Icon({
  name,
}: {
  name:
    | "reports"
    | "plus"
    | "user"
    | "logout"
    | "sun"
    | "moon"
    | "menu"
    | "close"
    | "search"
    | "file"
    | "download"
    | "arrow"
    | "check"
    | "link"
    | "lock"
    | "eye"
    | "grid"
    | "alert";
}) {
  const paths = {
    reports: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
    plus: "M12 5v14M5 12h14",
    user: "M20 21v-2a7 7 0 0 0-14 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    logout: "M9 5H4v14h5M9 12h12m-4-4 4 4-4 4",
    sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    moon: "M20 15a8 8 0 0 1-11-11 9 9 0 1 0 11 11",
    menu: "M4 6h16M4 12h16M4 18h16",
    close: "m6 6 12 12M18 6 6 18",
    search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5",
    file: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6",
    download: "M12 3v12m-5-5 5 5 5-5M5 18v3h14v-3",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    check: "m5 12 4 4L19 6",
    link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
    lock: "M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    alert: "M12 3 2 21h20L12 3M12 9v5M12 17v.1",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
const ThemeContext = createContext({
  theme: "dark" as "dark" | "light",
  toggle: () => {},
});
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem("gnps2-theme");
    return stored === "light" || stored === "dark"
      ? stored
      : matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gnps2-theme", theme);
  }, [theme]);
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () =>
          setTheme((value) => (value === "dark" ? "light" : "dark")),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="ui-button icon-button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Bật giao diện sáng" : "Bật giao diện tối"}
      title={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
export function Brand() {
  return (
    <div className="workspace-brand">
      <img src="/favicon.svg" alt="" />
      <div>
        <strong>
          GNPS<span>2</span>
        </strong>
        <small>CONVERTER</small>
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon = "reports",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: Parameters<typeof Icon>[0]["name"];
}) {
  return (
    <div className="ui-empty">
      <span>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
type Question = {
  title: string;
  message: string;
  accept?: string;
  danger?: boolean;
};
const ConfirmContext = createContext<(question: Question) => Promise<boolean>>(
  async () => false,
);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    resolve = useRef<((value: boolean) => void) | null>(null);
  const finish = (answer: boolean) => {
    resolve.current?.(answer);
    resolve.current = null;
    dialog.current?.close();
    setQuestion(null);
  };
  useEffect(() => {
    if (question && !dialog.current?.open) dialog.current?.showModal();
  }, [question]);
  useEffect(() => () => resolve.current?.(false), []);
  return (
    <ConfirmContext.Provider
      value={(q) =>
        new Promise<boolean>((done) => {
          resolve.current?.(false);
          resolve.current = done;
          setQuestion(q);
        })
      }
    >
      {children}
      <dialog
        ref={dialog}
        className="ui-dialog"
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) finish(false);
        }}
      >
        {question && (
          <>
            <span
              className={`dialog-symbol ${question.danger ? "danger" : ""}`}
            >
              <Icon name={question.danger ? "alert" : "file"} />
            </span>
            <h2 id="confirm-title">{question.title}</h2>
            <p>{question.message}</p>
            <div className="ui-dialog-actions">
              <button
                className="ui-button"
                autoFocus
                onClick={() => finish(false)}
              >
                Hủy
              </button>
              <button
                className={`ui-button ${question.danger ? "danger-button" : "primary"}`}
                onClick={() => finish(true)}
              >
                {question.accept ?? "Tiếp tục"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
// Applies keyboard containment to existing editor dialogs without changing their data flow.
export function useEditorDialogs(active: boolean, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const scope = document.querySelector<HTMLElement>(
      ".compound-dialog, .mapping-dialog",
    );
    if (!scope) return;
    const controls = () =>
      Array.from(
        scope.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
        ),
      ).filter((el) => el.getClientRects().length > 0);
    controls()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        callback.current();
      }
      if (e.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [active]);
}

export function tabKeys(event: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[index]?.focus();
  tabs[index]?.click();
}
