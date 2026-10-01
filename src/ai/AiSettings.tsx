import { useEffect, useState } from "react";
import { jsonApi, jsonBody } from "../api";
import { useConfirm } from "../Ui";
import type { Provider, Model } from "./types";
export function ModelPicker({
  providers,
  value,
  onChange,
  disabled = false,
}: {
  providers: Provider[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Chọn provider và model"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Theo cấu hình mặc định</option>
      {providers
        .filter((p) => p.enabled)
        .map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models
              .filter((m) => m.enabled)
              .map((m) => (
                <option key={m.model_id} value={`${p.id}|${m.model_id}`}>
                  {m.display_name}
                  {m.verified_at ? " · đã thử" : ""}
                </option>
              ))}
          </optgroup>
        ))}
    </select>
  );
}
export function AiSettings() {
  const [providers, setProviders] = useState<Provider[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [key, setKey] = useState(""),
    [enabled, setEnabled] = useState(true),
    [defaultModel, setDefaultModel] = useState(""),
    [usage, setUsage] = useState<any>(null);
  const confirm = useConfirm();
  async function refresh() {
    const [p, s, u] = await Promise.all([
      jsonApi<Provider[]>("/api/ai/providers"),
      jsonApi<any[]>("/api/ai/settings"),
      jsonApi("/api/ai/usage"),
    ]);
    setProviders(p);
    setUsage(u);
    const d = s.find((x) => x.scope === "account");
    setDefaultModel(d ? `${d.provider_id}|${d.model_id}` : "");
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="research-page ai-settings">
      <div className="page-heading">
        <div>
          <span className="eyebrow">API & MODEL</span>
          <h1>Cài đặt AI</h1>
          <p>
            API key được mã hóa tại máy chủ. Dữ liệu nghiên cứu chỉ được gửi khi
            bạn chat.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="ai-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-notice">
          {notice}
        </p>
      )}
      <div className="research-columns">
        <form
          className="ai-card"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await jsonApi(
                `/api/ai/providers${editing ? `/${editing}` : ""}`,
                jsonBody(
                  {
                    name,
                    baseUrl: url,
                    enabled,
                    ...(key ? { apiKey: key } : {}),
                  },
                  editing ? "PATCH" : "POST",
                ),
              );
              setKey("");
              setName("");
              setUrl("");
              setEditing("");
              setEnabled(true);
            }, "Đã lưu provider.");
          }}
        >
          <h2>{editing ? "Sửa provider" : "Thêm provider"}</h2>
          <label>
            Tên provider
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên dịch vụ AI"
            />
          </label>
          <label>
            Base URL
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <small>
            URL gốc OpenAI-compatible, không thêm /chat/completions.
          </small>
          <label>
            API key
            <input
              type="password"
              autoComplete="new-password"
              required={!editing}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                editing ? "Để trống để giữ key hiện tại" : "Nhập API key"
              }
            />
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Bật provider
          </label>
          <button disabled={busy} type="submit">
            Lưu provider
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing("");
                setName("");
                setUrl("");
                setKey("");
                setEnabled(true);
              }}
            >
              Hủy sửa
            </button>
          )}
        </form>
        <section className="ai-card">
          <h2>Model mặc định tài khoản</h2>
          <ModelPicker
            providers={providers}
            value={defaultModel}
            onChange={setDefaultModel}
          />
          <button
            disabled={busy || !defaultModel}
            onClick={() =>
              void act(async () => {
                const [providerId, modelId] = defaultModel.split("|");
                await jsonApi(
                  "/api/ai/settings",
                  jsonBody({ scope: "account", providerId, modelId }),
                );
              }, "Đã lưu model mặc định.")
            }
          >
            Lưu mặc định
          </button>
          <p>
            Phiên và project có thể chọn model riêng. Model mỗi lượt được lưu
            cùng lịch sử.
          </p>
          {usage && (
            <p>
              Hôm nay: <b>{usage.requests}</b> lượt · token vào:{" "}
              {usage.input_tokens ?? "chưa xác định"} · ra:{" "}
              {usage.output_tokens ?? "chưa xác định"} · {usage.unknown_usage}{" "}
              lượt chưa có số token. Có thể nhập đơn giá tại từng model để ước
              tính chi phí.
            </p>
          )}
        </section>
      </div>
      {providers.map((p) => (
        <section key={p.id} className="ai-card">
          <div className="ai-card-heading">
            <div>
              <h2>
                {p.name} {!p.enabled && "· đã tắt"}
              </h2>
              <small>{p.base_url} · API key đã cấu hình</small>
            </div>
            <div className="ai-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(p.id);
                  setName(p.name);
                  setUrl(p.base_url);
                  setEnabled(p.enabled);
                  setKey("");
                }}
              >
                Sửa
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      jsonApi(
                        `/api/ai/providers/${p.id}/discover-models`,
                        jsonBody({}),
                      ),
                    "Đã tải catalog; chat thử để kiểm tra quyền dùng model.",
                  )
                }
              >
                Tải model
              </button>
            </div>
          </div>
          <div className="model-grid">
            {p.models.map((m) => (
              <ModelEditor
                key={m.model_id}
                model={m}
                disabled={busy}
                save={(value) =>
                  act(
                    () =>
                      jsonApi(
                        `/api/ai/providers/${p.id}/models`,
                        jsonBody(value),
                      ),
                    "Đã lưu model.",
                  )
                }
                test={async () => {
                  if (
                    await confirm({
                      title: "Chat thử model?",
                      message:
                        "Phép thử gửi câu hỏi ngắn tới provider và có thể phát sinh phí API.",
                      accept: "Chat thử",
                    })
                  )
                    await act(
                      () =>
                        jsonApi(
                          `/api/ai/providers/${p.id}/test`,
                          jsonBody({ modelId: m.model_id }),
                        ),
                      "Model đã trả lời thử thành công.",
                    );
                }}
              />
            ))}
            <ModelEditor
              disabled={busy}
              save={(value) =>
                act(
                  () =>
                    jsonApi(
                      `/api/ai/providers/${p.id}/models`,
                      jsonBody(value),
                    ),
                  "Đã thêm model.",
                )
              }
            />
          </div>
        </section>
      ))}
    </section>
  );
}
function ModelEditor({
  model,
  disabled,
  save,
  test,
}: {
  model?: Model;
  disabled: boolean;
  save: (v: unknown) => Promise<void>;
  test?: () => Promise<void>;
}) {
  const [id, setId] = useState(model?.model_id ?? ""),
    [name, setName] = useState(model?.display_name ?? ""),
    [enabled, setEnabled] = useState(model?.enabled ?? true),
    [tools, setTools] = useState(model?.supports_tools ?? false),
    [stream, setStream] = useState(model?.supports_stream ?? false),
    [context, setContext] = useState(model?.context_limit ?? 16000),
    [output, setOutput] = useState(model?.max_output ?? 2000),
    [inputPrice, setInputPrice] = useState(
      model?.input_price_per_million ?? "",
    ),
    [outputPrice, setOutputPrice] = useState(
      model?.output_price_per_million ?? "",
    ),
    [currency, setCurrency] = useState(model?.currency ?? "USD");
  return (
    <form
      className="model-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          modelId: id,
          displayName: name || id,
          enabled,
          supportsTools: tools,
          supportsStream: stream,
          contextLimit: context,
          maxOutput: output,
          inputPricePerMillion: inputPrice === "" ? null : Number(inputPrice),
          outputPricePerMillion:
            outputPrice === "" ? null : Number(outputPrice),
          currency,
        });
      }}
    >
      <h3>{model ? model.display_name : "Nhập model thủ công"}</h3>
      <label>
        Mã model
        <input
          value={id}
          required
          readOnly={!!model}
          maxLength={180}
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label>
        Tên hiển thị
        <input
          value={name}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="ai-actions">
        <label className="ai-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Bật
        </label>
        <label className="ai-check">
          <input
            type="checkbox"
            checked={tools}
            onChange={(e) => setTools(e.target.checked)}
          />
          Tools
        </label>
        <label className="ai-check">
          <input
            type="checkbox"
            checked={stream}
            onChange={(e) => setStream(e.target.checked)}
          />
          Stream
        </label>
      </div>
      <small>Chỉ bật Tools/Stream khi provider/model hỗ trợ.</small>
      <div className="ai-actions">
        <label>
          Context
          <input
            type="number"
            min={2000}
            max={200000}
            required
            value={context}
            onChange={(e) => setContext(Number(e.target.value))}
          />
        </label>
        <label>
          Output
          <input
            type="number"
            min={128}
            max={16000}
            required
            value={output}
            onChange={(e) => setOutput(Number(e.target.value))}
          />
        </label>
      </div>
      <details>
        <summary>Đơn giá tùy chọn</summary>
        <label>
          Giá input / 1 triệu token
          <input
            type="number"
            min="0"
            max="100000"
            step="any"
            value={inputPrice}
            onChange={(e) => setInputPrice(e.target.value)}
          />
        </label>
        <label>
          Giá output / 1 triệu token
          <input
            type="number"
            min="0"
            max="100000"
            step="any"
            value={outputPrice}
            onChange={(e) => setOutputPrice(e.target.value)}
          />
        </label>
        <label>
          Tiền tệ
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option>USD</option>
            <option>VND</option>
            <option>EUR</option>
          </select>
        </label>
        <small>
          Ước tính theo đơn giá bạn nhập; không thay thế hóa đơn nhà cung cấp.
          Để trống nếu chưa biết.
        </small>
      </details>
      <div className="ai-actions">
        <button disabled={disabled || !id} type="submit">
          Lưu model
        </button>
        {test && (
          <button disabled={disabled} type="button" onClick={() => void test()}>
            Chat thử
          </button>
        )}
      </div>
      <small>
        {model?.verified_at ? "Đã xác minh bằng chat thử" : "Chưa xác minh"}
      </small>
    </form>
  );
}
