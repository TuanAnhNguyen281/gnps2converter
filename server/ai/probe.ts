import { ApiError } from "../errors.js";
import { boundedJson, streamCompletion } from "./provider.js";

export interface ProbeResult {
  content: string;
  stream: "ok" | "failed";
  streamOptions: "accepted" | "rejected" | null;
  streamUsage: boolean | null;
  tools: "ok" | "failed";
  usage: boolean;
  // Provider usage where reported, otherwise prompt + max_tokens per call.
  tokens: number;
  notes: string[];
}
const spentOn = (u: any, fallback: number) =>
  typeof u?.prompt_tokens === "number" &&
  typeof u?.completion_tokens === "number"
    ? u.prompt_tokens + u.completion_tokens
    : fallback;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Lỗi không xác định.";
// Checks what a model really supports so Tools/Stream are enabled from evidence, not catalog claims.
// `call` posts to chat/completions and throws ApiError on non-2xx.
export async function probeModel(
  model: string,
  call: (body: Record<string, unknown>) => Promise<Response>,
): Promise<ProbeResult> {
  const notes: string[] = [];
  const plain = await boundedJson(
    await call({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 32,
    }),
  );
  const content = plain.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new ApiError(502, "Model không trả lời văn bản.");
  const usage =
    typeof plain.usage?.prompt_tokens === "number" &&
    typeof plain.usage?.completion_tokens === "number";
  if (!usage) notes.push("Provider không trả usage cho lượt thường.");
  let tokens = spentOn(plain.usage, 52);

  let stream: ProbeResult["stream"] = "failed",
    streamOptions: ProbeResult["streamOptions"] = null,
    streamUsage: boolean | null = null;
  const streamBody = {
    model,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 32,
    stream: true,
  };
  try {
    let response: Response;
    try {
      response = await call({
        ...streamBody,
        stream_options: { include_usage: true },
      });
      streamOptions = "accepted";
    } catch (e) {
      if (
        !(e instanceof ApiError) ||
        !["AI_PROVIDER_400", "AI_PROVIDER_422"].includes(e.code)
      )
        throw e;
      streamOptions = "rejected";
      notes.push("Provider từ chối stream_options; sẽ gửi stream không kèm.");
      response = await call(streamBody);
    }
    const r = await streamCompletion(response, async () => {});
    stream = "ok";
    tokens += spentOn(r.usage, 52);
    streamUsage =
      typeof r.usage?.prompt_tokens === "number" &&
      typeof r.usage?.completion_tokens === "number";
    if (!streamUsage)
      notes.push(
        "Stream không trả usage; token các lượt stream sẽ là ước tính.",
      );
  } catch (e) {
    // The call may still have been billed; count it conservatively.
    tokens += 52;
    notes.push(`Stream lỗi: ${message(e)}`);
  }

  let tools: ProbeResult["tools"] = "failed";
  try {
    const json = await boundedJson(
      await call({
        model,
        messages: [
          {
            role: "user",
            content: "Call the ping tool now. Do not answer with text.",
          },
        ],
        max_tokens: 64,
        tools: [
          {
            type: "function",
            function: {
              name: "ping",
              description: "Connectivity check. Takes no arguments.",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        tool_choice: "auto",
      }),
    );
    tokens += spentOn(json.usage, 150);
    const call0 = json.choices?.[0]?.message?.tool_calls?.[0];
    if (call0?.function?.name === "ping") tools = "ok";
    else notes.push("Model không gọi công cụ khi được yêu cầu.");
  } catch (e) {
    tokens += 150;
    notes.push(`Tools lỗi: ${message(e)}`);
  }
  return {
    content: content.slice(0, 200),
    stream,
    streamOptions,
    streamUsage,
    tools,
    usage,
    tokens,
    notes,
  };
}
