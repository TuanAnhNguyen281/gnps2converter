import { useEffect, useState } from "react";
import { jsonApi, jsonBody } from "../api";
import { useConfirm } from "../Ui";
import type { Provider, Model, ProbeResult, ProviderQuota } from "./types";
import { AdminUsage } from "./AdminUsage";
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
const fmt = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("vi-VN");
export function QuotaMeter({
  quota,
  compact = false,
}: {
  quota: ProviderQuota;
  compact?: boolean;
}) {
  const rows = [
    ["Tháng này", quota.monthUsed, quota.monthUsable],
    ["Hôm nay", quota.dayUsed, quota.dayUsable],
  ] as const;
  return (
    <div className={`quota-meter${compact ? " compact" : ""}`}>
      {rows.map(([label, used, usable]) => {
        const ratio = usable ? used / usable : 0;
        return (
          <div key={label} className={ratio >= 0.9 ? "warn" : ""}>
            <span>
              {label}: {fmt(used)} /{" "}
              {usable === null ? "không giới hạn" : `${fmt(usable)} token`}
              {usable !== null && ratio >= 0.9 && " · sắp hết"}
            </span>
            {usable !== null && (
              <progress
                max={usable}
                value={Math.min(used, usable)}
                aria-label={`Token đã dùng ${label.toLowerCase()}`}
              />
            )}
          </div>
        );
      })}
      {!compact && (
        <small>
          Khả dụng = hạn mức provider trừ {quota.reservePercent}% dự phòng. Chỉ
          tính lượt gửi từ GNPS theo giờ Việt Nam; lượt chưa có usage tính theo
          mức giữ chỗ, lượt lỗi tính ước tính. Dashboard provider là nguồn đối
          chiếu.
        </small>
      )}
    </div>
  );
}
interface UsageSummary {
  days: number;
  byDay: {
    day: string;
    requests: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    estimated: number;
  }[];
  byModel: {
    provider_name: string;
    model_id: string;
    requests: number;
    completed: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    estimated_cost: number | null;
    currency: string | null;
    actual_to_estimate: number | null;
  }[];
}
// Own usage only: the app has no admin role, so nobody sees other accounts.
function UsageTables({ summary }: { summary: UsageSummary }) {
  if (!summary.byModel.length) return null;
  return (
    <details className="ai-card usage-summary">
      <summary>Thống kê sử dụng {summary.days} ngày</summary>
      <div className="md-table">
        <table>
          <thead>
            <tr>
              <th>Provider · model</th>
              <th>Lượt</th>
              <th>Lỗi</th>
              <th>Token vào</th>
              <th>Token ra</th>
              <th>Vào từ cache</th>
              <th>Thực tế/dự toán</th>
              <th>Chi phí ước tính</th>
            </tr>
          </thead>
          <tbody>
            {summary.byModel.map((m) => (
              <tr key={`${m.provider_name}|${m.model_id}`}>
                <td>
                  {m.provider_name} · {m.model_id}
                </td>
                <td>{m.requests}</td>
                <td>{m.failed}</td>
                <td>{fmt(m.input_tokens)}</td>
                <td>{fmt(m.output_tokens)}</td>
                <td>
                  {m.cached_input_tokens ? fmt(m.cached_input_tokens) : "—"}
                </td>
                <td>
                  {m.actual_to_estimate === null
                    ? "—"
                    : `${m.actual_to_estimate}×`}
                </td>
                <td>
                  {m.estimated_cost === null
                    ? "—"
                    : `${m.estimated_cost.toFixed(4)} ${m.currency ?? ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Lượt</th>
              <th>Lỗi</th>
              <th>Token vào</th>
              <th>Token ra</th>
              <th>Lượt ước tính</th>
            </tr>
          </thead>
          <tbody>
            {summary.byDay.slice(0, 14).map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.requests}</td>
                <td>{d.failed}</td>
                <td>{fmt(d.input_tokens)}</td>
                <td>{fmt(d.output_tokens)}</td>
                <td>{d.estimated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        “Thực tế/dự toán” = token vào provider báo ÷ ước tính của ứng dụng; dùng
        để hiệu chỉnh mức giữ chỗ. “Lượt ước tính” là lượt không có usage từ
        provider (tính theo mức giữ chỗ hoặc ước tính).
      </small>
    </details>
  );
}
const MOTAPI_PRESET = {
  name: "MộtAPI",
  url: "https://motapis.com/v1",
  monthly: "2000000",
  daily: "2000000",
  reserve: "10",
};
const describeProbe = (c: ProbeResult) =>
  [
    `Chat: OK ("${c.content}")`,
    `Stream: ${
      c.stream === "ok"
        ? `OK${c.streamUsage ? " có usage" : " không có usage"}${
            c.streamOptions === "rejected" ? ", không nhận stream_options" : ""
          }`
        : "lỗi"
    }`,
    `Tools: ${c.tools === "ok" ? "OK" : "không hỗ trợ"}`,
    ...c.notes,
  ].join(" · ");
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
    [monthly, setMonthly] = useState(MOTAPI_PRESET.monthly),
    [daily, setDaily] = useState(MOTAPI_PRESET.daily),
    [reserve, setReserve] = useState(MOTAPI_PRESET.reserve),
    [defaultModel, setDefaultModel] = useState(""),
    [usage, setUsage] = useState<any>(null),
    [summary, setSummary] = useState<UsageSummary | null>(null);
  const confirm = useConfirm();
  async function refresh() {
    const [p, s, u, sum] = await Promise.all([
      jsonApi<Provider[]>("/api/ai/providers"),
      jsonApi<any[]>("/api/ai/settings"),
      jsonApi("/api/ai/usage"),
      jsonApi<UsageSummary>("/api/ai/usage/summary?days=30"),
    ]);
    setProviders(p);
    setUsage(u);
    setSummary(sum);
    const d = s.find((x) => x.scope === "account");
    setDefaultModel(d ? `${d.provider_id}|${d.model_id}` : "");
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  function resetForm() {
    setEditing("");
    setName("");
    setUrl("");
    setKey("");
    setEnabled(true);
    setMonthly(MOTAPI_PRESET.monthly);
    setDaily(MOTAPI_PRESET.daily);
    setReserve(MOTAPI_PRESET.reserve);
  }
  async function act(
    run: () => Promise<unknown>,
    message: string | ((result: any) => string),
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await run();
      await refresh();
      setNotice(typeof message === "string" ? message : message(result));
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
                    monthlyTokenLimit: monthly ? Number(monthly) : null,
                    dailyTokenLimit: daily ? Number(daily) : null,
                    quotaReservePercent: Number(reserve || 0),
                  },
                  editing ? "PATCH" : "POST",
                ),
              );
              resetForm();
            }, "Đã lưu provider.");
          }}
        >
          <h2>{editing ? "Sửa provider" : "Thêm provider"}</h2>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setName(MOTAPI_PRESET.name);
                setUrl(MOTAPI_PRESET.url);
                setMonthly(MOTAPI_PRESET.monthly);
                setDaily(MOTAPI_PRESET.daily);
                setReserve(MOTAPI_PRESET.reserve);
              }}
            >
              Điền mẫu MộtAPI (gói miễn phí)
            </button>
          )}
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
          <fieldset className="quota-fields">
            <legend>Hạn mức token của tài khoản provider</legend>
            <label>
              Token/tháng
              <input
                type="number"
                min={1000}
                step={1000}
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="Không giới hạn"
              />
            </label>
            <label>
              Token/ngày
              <input
                type="number"
                min={1000}
                step={1000}
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                placeholder="Không giới hạn"
              />
            </label>
            <label>
              Dự phòng (%)
              <input
                type="number"
                min={0}
                max={90}
                required
                value={reserve}
                onChange={(e) => setReserve(e.target.value)}
              />
            </label>
            <small>
              Gói miễn phí MộtAPI chưa nạp: 2.000.000 token/tháng. Chỉ nâng khi
              dashboard xác nhận gói lớn hơn. Để trống = không chặn trong ứng
              dụng.
            </small>
          </fieldset>
          <button disabled={busy} type="submit">
            Lưu provider
          </button>
          {editing && (
            <button type="button" onClick={resetForm}>
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
      {summary && <UsageTables summary={summary} />}
      <AdminUsage />
      {providers.map((p) => (
        <section key={p.id} className="ai-card">
          <div className="ai-card-heading">
            <div>
              <h2>
                {p.name} {!p.enabled && "· đã tắt"}
              </h2>
              <small>{p.base_url} · API key đã cấu hình</small>
              {p.quota && <QuotaMeter quota={p.quota} />}
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
                  setMonthly(
                    p.monthly_token_limit === null
                      ? ""
                      : String(p.monthly_token_limit),
                  );
                  setDaily(
                    p.daily_token_limit === null
                      ? ""
                      : String(p.daily_token_limit),
                  );
                  setReserve(String(p.quota_reserve_percent ?? 10));
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
                        "Phép thử gửi 3 yêu cầu ngắn (chat, stream, tools) tới provider và có thể phát sinh phí API.",
                      accept: "Chat thử",
                    })
                  )
                    await act(
                      () =>
                        jsonApi(
                          `/api/ai/providers/${p.id}/test`,
                          jsonBody({ modelId: m.model_id }),
                        ),
                      (r: { checks: ProbeResult }) =>
                        `Đã chat thử. ${describeProbe(r.checks)}. Bật Tools/Stream theo kết quả này.`,
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
