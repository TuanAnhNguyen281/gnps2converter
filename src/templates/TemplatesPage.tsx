import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableCell, TableHeader } from "@tiptap/extension-table";
import { jsonApi, jsonBody } from "../api";
import { useConfirm } from "../Ui";
import type { SavedResult } from "../useReport";
import {
  DEFAULT_PAGE,
  DEFAULT_REPEAT,
  FIELD_BY_KEY,
  TEMPLATE_FIELDS,
  type PageSettings,
  type RepeatSpec,
  type TemplateNode,
  type TemplateReport,
} from "../../server/shared/report-template";
import { FieldNode, PageBreakNode, RepeatTableRow } from "./extensions";
import { TemplatePreview, pageStyle } from "./TemplatePreview";
import "./templates.css";

interface TemplateSummary {
  id: string;
  name: string;
  updated_at: string;
}
interface Template extends TemplateSummary {
  content: TemplateNode;
  page: PageSettings;
}
const GROUPS = [...new Set(TEMPLATE_FIELDS.map((f) => f.group))];
const FILTERS: [RepeatSpec["filter"], string][] = [
  ["selected", "Dòng đã chọn"],
  ["all", "Tất cả dòng"],
  ["matched", "Chỉ đã khớp"],
  ["ambiguous", "Chỉ chưa chắc chắn"],
  ["unmatched", "Chỉ chưa khớp"],
];

function Toolbar({ editor }: { editor: Editor }) {
  const run = (
    fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
  ) => fn(editor.chain().focus()).run();
  const btn = (
    label: string,
    title: string,
    active: boolean,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const inTable = editor.isActive("table");
  const block = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";
  return (
    <div className="tpl-toolbar" role="toolbar" aria-label="Định dạng">
      <select
        aria-label="Kiểu đoạn"
        value={block}
        onChange={(e) =>
          run((c) =>
            e.target.value === "p"
              ? c.setParagraph()
              : c.setHeading({
                  level: Number(e.target.value.slice(1)) as 1 | 2 | 3,
                }),
          )
        }
      >
        <option value="p">Đoạn văn</option>
        <option value="h1">Tiêu đề 1</option>
        <option value="h2">Tiêu đề 2</option>
        <option value="h3">Tiêu đề 3</option>
      </select>
      <span className="tpl-sep" />
      {btn("B", "Đậm", editor.isActive("bold"), () =>
        run((c) => c.toggleBold()),
      )}
      {btn("I", "Nghiêng", editor.isActive("italic"), () =>
        run((c) => c.toggleItalic()),
      )}
      {btn("U", "Gạch chân", editor.isActive("underline"), () =>
        run((c) => c.toggleUnderline()),
      )}
      {btn("S", "Gạch ngang", editor.isActive("strike"), () =>
        run((c) => c.toggleStrike()),
      )}
      <span className="tpl-sep" />
      {(["left", "center", "right", "justify"] as const).map((a) =>
        btn(
          { left: "⇤", center: "↔", right: "⇥", justify: "≡" }[a],
          {
            left: "Căn trái",
            center: "Căn giữa",
            right: "Căn phải",
            justify: "Căn đều",
          }[a],
          editor.isActive({ textAlign: a }),
          () => run((c) => c.setTextAlign(a)),
        ),
      )}
      <span className="tpl-sep" />
      {btn("•", "Danh sách chấm", editor.isActive("bulletList"), () =>
        run((c) => c.toggleBulletList()),
      )}
      {btn("1.", "Danh sách số", editor.isActive("orderedList"), () =>
        run((c) => c.toggleOrderedList()),
      )}
      {btn("⤓", "Ngắt trang", false, () =>
        run((c) => c.insertContent({ type: "pageBreak" })),
      )}
      <span className="tpl-sep" />
      {btn(
        "▦",
        "Chèn bảng 2×4",
        false,
        () =>
          run((c) => c.insertTable({ rows: 2, cols: 4, withHeaderRow: true })),
        inTable,
      )}
      {btn(
        "+Hàng",
        "Thêm hàng bên dưới",
        false,
        () => run((c) => c.addRowAfter()),
        !inTable,
      )}
      {btn(
        "+Cột",
        "Thêm cột bên phải",
        false,
        () => run((c) => c.addColumnAfter()),
        !inTable,
      )}
      {btn(
        "−Hàng",
        "Xóa hàng",
        false,
        () => run((c) => c.deleteRow()),
        !inTable,
      )}
      {btn(
        "−Cột",
        "Xóa cột",
        false,
        () => run((c) => c.deleteColumn()),
        !inTable,
      )}
      {btn(
        "Gộp",
        "Gộp ô đã chọn",
        false,
        () => run((c) => c.mergeCells()),
        !editor.can().mergeCells(),
      )}
      {btn(
        "Tách",
        "Tách ô",
        false,
        () => run((c) => c.splitCell()),
        !editor.can().splitCell(),
      )}
      {btn(
        "Tiêu đề",
        "Bật/tắt hàng tiêu đề",
        false,
        () => run((c) => c.toggleHeaderRow()),
        !inTable,
      )}
      {btn(
        "✕Bảng",
        "Xóa bảng",
        false,
        () => run((c) => c.deleteTable()),
        !inTable,
      )}
      <span className="tpl-sep" />
      {btn(
        "↶",
        "Hoàn tác",
        false,
        () => run((c) => c.undo()),
        !editor.can().undo(),
      )}
      {btn(
        "↷",
        "Làm lại",
        false,
        () => run((c) => c.redo()),
        !editor.can().redo(),
      )}
    </div>
  );
}

function SidePanel({
  editor,
  page,
  setPage,
}: {
  editor: Editor;
  page: PageSettings;
  setPage: (p: PageSettings) => void;
}) {
  const inRow = editor.isActive("tableRow") || editor.isActive("table");
  const repeat = (editor.getAttributes("tableRow").repeat ??
    null) as RepeatSpec | null;
  const field = editor.isActive("field") ? editor.getAttributes("field") : null;
  const fieldDef = field ? FIELD_BY_KEY.get(field.key) : null;
  const setRepeat = (value: RepeatSpec | null) =>
    editor
      .chain()
      .focus()
      .updateAttributes("tableRow", { repeat: value })
      .run();
  return (
    <aside className="tpl-side">
      <section>
        <h3>Chèn trường dữ liệu</h3>
        <p className="tpl-hint">
          Bấm để chèn tại con trỏ. Trường thuộc nhóm dòng chỉ có giá trị khi nằm
          trong hàng lặp của bảng.
        </p>
        {GROUPS.map((group) => (
          <details
            key={group}
            open={group === "Báo cáo" || group === "Dòng dữ liệu"}
          >
            <summary>{group}</summary>
            <div className="tpl-fields">
              {TEMPLATE_FIELDS.filter((f) => f.group === group).map((f) => (
                <button
                  type="button"
                  key={f.key}
                  className={`tpl-field-button${f.scope === "row" ? " row" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "field",
                        attrs: { key: f.key, decimals: null },
                      })
                      .run()
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </details>
        ))}
      </section>
      {field && fieldDef && (
        <section>
          <h3>Trường đang chọn</h3>
          <p>
            <b>{fieldDef.label}</b> · {fieldDef.group}
          </p>
          {fieldDef.kind === "number" && (
            <label>
              Số chữ số thập phân tối đa
              <input
                type="number"
                min={0}
                max={8}
                value={field.decimals ?? fieldDef.decimals ?? 3}
                onChange={(e) =>
                  editor
                    .chain()
                    .updateAttributes("field", {
                      decimals:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                    .run()
                }
              />
            </label>
          )}
        </section>
      )}
      {inRow && (
        <section>
          <h3>Hàng của bảng</h3>
          <label className="tpl-check">
            <input
              type="checkbox"
              checked={!!repeat}
              onChange={(e) =>
                setRepeat(e.target.checked ? { ...DEFAULT_REPEAT } : null)
              }
            />
            Lặp hàng này theo dòng dữ liệu
          </label>
          {repeat && (
            <>
              <label>
                Dòng được lặp
                <select
                  value={repeat.filter}
                  onChange={(e) =>
                    setRepeat({
                      ...repeat,
                      filter: e.target.value as RepeatSpec["filter"],
                    })
                  }
                >
                  {FILTERS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Thứ tự
                <select
                  value={repeat.sort}
                  onChange={(e) =>
                    setRepeat({
                      ...repeat,
                      sort: e.target.value as RepeatSpec["sort"],
                    })
                  }
                >
                  <option value="report">Theo thứ tự báo cáo</option>
                  <option value="abs_ppm_desc">|Sai số ppm| giảm dần</option>
                </select>
              </label>
            </>
          )}
        </section>
      )}
      <section>
        <h3>Trang</h3>
        <label>
          Hướng giấy A4
          <select
            value={page.orientation}
            onChange={(e) =>
              setPage({
                ...page,
                orientation: e.target.value as PageSettings["orientation"],
              })
            }
          >
            <option value="landscape">Ngang</option>
            <option value="portrait">Dọc</option>
          </select>
        </label>
        <div className="tpl-margins">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side}>
              {
                {
                  top: "Lề trên",
                  right: "Lề phải",
                  bottom: "Lề dưới",
                  left: "Lề trái",
                }[side]
              }{" "}
              (mm)
              <input
                type="number"
                min={5}
                max={60}
                value={page.margins[side]}
                onChange={(e) =>
                  setPage({
                    ...page,
                    margins: {
                      ...page.margins,
                      [side]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>
    </aside>
  );
}

function TemplateEditor({
  template,
  onSaved,
}: {
  template: Template;
  onSaved: (t: TemplateSummary) => void;
}) {
  const [name, setName] = useState(template.name),
    [page, setPageState] = useState<PageSettings>({
      ...DEFAULT_PAGE,
      ...template.page,
    }),
    [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">(
      "saved",
    ),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"edit" | "preview">("edit"),
    [reports, setReports] = useState<{ id: string; title: string }[]>([]),
    [reportId, setReportId] = useState(""),
    [previewData, setPreviewData] = useState<TemplateReport | null>(null),
    // Like Word's zoom: an A4 landscape page is wider than most editor panes.
    // 0 = fit the page width to the pane.
    [zoomChoice, setZoomChoice] = useState(0),
    [fit, setFit] = useState(1);
  const zoom = zoomChoice || fit;
  const paneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      // 1mm = 96/25.4 CSS px; keep 32px of the pane's padding.
      const pagePx =
        (page.orientation === "landscape" ? 297 : 210) * (96 / 25.4);
      setFit(Math.min(1, Math.max(0.3, (pane.clientWidth - 32) / pagePx)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [page.orientation, mode]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    latest = useRef({ name, page });
  latest.current = { name, page };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        link: false,
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      RepeatTableRow,
      TableHeader,
      TableCell,
      FieldNode,
      PageBreakNode,
    ],
    content: template.content,
    shouldRerenderOnTransaction: true,
    onUpdate: () => schedule(),
  });
  // Autosave shortly after the last change; the server stores the sanitized form.
  function schedule() {
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  }
  async function save() {
    if (!editor) return;
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    setError("");
    try {
      const saved = await jsonApi<Template>(
        `/api/report-templates/${template.id}`,
        jsonBody(
          {
            name: latest.current.name.trim() || "Mẫu không tên",
            content: editor.getJSON(),
            page: latest.current.page,
          },
          "PATCH",
        ),
      );
      setStatus("saved");
      onSaved(saved);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function setPage(next: PageSettings) {
    setPageState(next);
    latest.current = { ...latest.current, page: next };
    schedule();
  }
  useEffect(() => {
    if (mode !== "preview" || reports.length) return;
    void jsonApi<{ items: { id: string; title: string }[] }>("/api/reports")
      .then((r) => {
        setReports(r.items);
        if (!reportId && r.items[0]) setReportId(r.items[0].id);
      })
      .catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => {
    if (mode !== "preview" || !reportId) return;
    let alive = true;
    setPreviewData(null);
    void Promise.all([
      jsonApi<SavedResult>(`/api/reports/${reportId}`),
      jsonApi<{ content: string } | null>(
        `/api/ai/reports/${reportId}/discussion`,
      ).catch(() => null),
    ])
      .then(([r, draft]) => {
        if (!alive) return;
        setPreviewData({
          title: r.title ?? "",
          sourceUrl: r.sourceUrl ?? null,
          task: r.task ?? null,
          exportedAt: new Date().toISOString(),
          parameters: r.parameters,
          summary: r.summary as unknown as Record<string, number>,
          rows: r.rows,
          discussion: draft?.content ?? null,
        });
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [mode, reportId]);
  const doc = useMemo(
    () =>
      mode === "preview" && editor ? (editor.getJSON() as TemplateNode) : null,
    [mode],
  );
  if (!editor) return null;
  return (
    <div className="tpl-editor">
      <div className="tpl-header">
        <input
          className="tpl-name"
          aria-label="Tên mẫu"
          value={name}
          maxLength={160}
          onChange={(e) => {
            setName(e.target.value);
            latest.current = { ...latest.current, name: e.target.value };
            schedule();
          }}
        />
        <span className={`tpl-status ${status}`} role="status">
          {
            {
              saved: "Đã lưu",
              dirty: "Chưa lưu…",
              saving: "Đang lưu…",
              error: "Lỗi lưu",
            }[status]
          }
        </span>
        <label className="tpl-zoom">
          Thu phóng
          <select
            value={zoomChoice}
            onChange={(e) => setZoomChoice(Number(e.target.value))}
          >
            <option value={0}>Vừa khung ({Math.round(fit * 100)}%)</option>
            <option value={0.6}>60%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
          </select>
        </label>
        <div className="tpl-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "edit"}
            className={mode === "edit" ? "active" : ""}
            onClick={() => setMode("edit")}
          >
            Soạn thảo
          </button>
          <button
            role="tab"
            aria-selected={mode === "preview"}
            className={mode === "preview" ? "active" : ""}
            onClick={() => {
              void save();
              setMode("preview");
            }}
          >
            Xem trước với dữ liệu
          </button>
        </div>
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      {mode === "edit" ? (
        <>
          <Toolbar editor={editor} />
          <div className="tpl-workspace">
            <div className="tpl-paper-scroll" ref={paneRef}>
              <div className="tpl-page" style={{ ...pageStyle(page), zoom }}>
                <EditorContent editor={editor} />
              </div>
            </div>
            <SidePanel editor={editor} page={page} setPage={setPage} />
          </div>
        </>
      ) : (
        <div className="tpl-preview-wrap">
          <label className="tpl-preview-pick">
            Báo cáo dùng để xem trước
            <select
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <div className="tpl-paper-scroll" ref={paneRef}>
            {doc && previewData ? (
              <TemplatePreview
                doc={doc}
                page={page}
                report={previewData}
                zoom={zoom}
              />
            ) : (
              <p role="status">
                {reports.length
                  ? "Đang tải dữ liệu báo cáo…"
                  : "Chưa có báo cáo đã lưu để xem trước."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplatesPage() {
  const [list, setList] = useState<TemplateSummary[]>([]),
    [current, setCurrent] = useState<Template | null>(null),
    [newName, setNewName] = useState(""),
    [start, setStart] = useState<"basic" | "blank">("basic"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  async function refresh() {
    setList(await jsonApi<TemplateSummary[]>("/api/report-templates"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function open(id: string) {
    setCurrent(await jsonApi<Template>(`/api/report-templates/${id}`));
  }
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
  return (
    <section className="research-page templates-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">XUẤT WORD</span>
          <h1>Mẫu Word</h1>
          <p>
            Soạn nội dung file Word, chèn bảng và trường dữ liệu của báo cáo.
            Khi xuất, các trường được điền theo báo cáo đã lưu; hàng lặp sinh
            một dòng cho mỗi hợp chất.
          </p>
        </div>
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="templates-layout">
        <aside className="ai-card templates-list">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const t = await jsonApi<Template>(
                  "/api/report-templates",
                  jsonBody({ name: newName.trim() || "Mẫu mới", start }),
                );
                setNewName("");
                await refresh();
                setCurrent(t);
              });
            }}
          >
            <label>
              Tên mẫu mới
              <input
                value={newName}
                maxLength={160}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ví dụ: Phụ lục luận văn"
              />
            </label>
            <label>
              Bắt đầu từ
              <select
                value={start}
                onChange={(e) => setStart(e.target.value as "basic" | "blank")}
              >
                <option value="basic">Mẫu cơ bản (giống xuất mặc định)</option>
                <option value="blank">Trang trắng</option>
              </select>
            </label>
            <button className="ui-button primary" disabled={busy} type="submit">
              Tạo mẫu
            </button>
          </form>
          <ul>
            {list.map((t) => (
              <li key={t.id} className={current?.id === t.id ? "active" : ""}>
                <button
                  type="button"
                  className="templates-open"
                  onClick={() => void act(() => open(t.id))}
                >
                  <b>{t.name}</b>
                  <small>
                    Sửa {new Date(t.updated_at).toLocaleString("vi-VN")}
                  </small>
                </button>
                <div className="ai-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const copy = await jsonApi<Template>(
                          `/api/report-templates/${t.id}/duplicate`,
                          jsonBody({}),
                        );
                        await refresh();
                        setCurrent(copy);
                      })
                    }
                  >
                    Nhân bản
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (
                          !(await confirm({
                            title: "Xóa mẫu Word?",
                            message: `Mẫu “${t.name}” sẽ bị xóa vĩnh viễn. Báo cáo và các file đã xuất không bị ảnh hưởng.`,
                            accept: "Xóa mẫu",
                          }))
                        )
                          return;
                        await jsonApi(
                          `/api/report-templates/${t.id}`,
                          jsonBody({}, "DELETE"),
                        );
                        if (current?.id === t.id) setCurrent(null);
                        await refresh();
                      })
                    }
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
            {!list.length && <li className="tpl-hint">Chưa có mẫu nào.</li>}
          </ul>
        </aside>
        <div className="templates-main">
          {current ? (
            <TemplateEditor
              key={current.id}
              template={current}
              onSaved={(saved) =>
                setList((prev) => [
                  saved,
                  ...prev.filter((x) => x.id !== saved.id),
                ])
              }
            />
          ) : (
            <div className="ai-card chat-empty">
              <h2>Chọn hoặc tạo một mẫu</h2>
              <p>
                Mẫu cơ bản đã có bảng hợp chất với hàng lặp, sẵn để chỉnh sửa.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
