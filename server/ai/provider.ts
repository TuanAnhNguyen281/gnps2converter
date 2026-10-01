import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { Readable } from "node:stream";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";

type Secret = { ciphertext: string; iv: string; tag: string };
function key(config: Config, version: string) {
  let raw = config.aiEncryptionKey;
  if (version !== config.aiKeyVersion) {
    try {
      raw = JSON.parse(config.aiPreviousKeys)[version] ?? "";
    } catch {
      raw = "";
    }
  }
  if (!/^[a-f\d]{64}$/i.test(raw))
    throw new ApiError(
      503,
      "Máy chủ chưa cấu hình khóa mã hóa AI hợp lệ.",
      "AI_KEY_UNAVAILABLE",
    );
  return Buffer.from(raw, "hex");
}
export function encryptKey(value: string, config: Config): Secret {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      key(config, config.aiKeyVersion),
      iv,
    );
  return {
    ciphertext: Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function decryptKey(secret: Secret, version: string, config: Config) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(config, version),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only globally routable native IPv6. Reject mapped IPv4 and transition ranges.
  if (isIP(address) === 6)
    return (
      /^2[0-9a-f]{3}:/i.test(address) &&
      !/^200[12]:/i.test(address) &&
      !/^2001:db8:/i.test(address)
    );
  return false;
}
export function providerUrl(base: string, endpoint: string, config: Config) {
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new ApiError(
      400,
      "Base URL phải dùng HTTPS, không chứa mật khẩu, query hoặc port riêng.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (config.aiAllowedHosts.length && !config.aiAllowedHosts.includes(host))
    throw new ApiError(
      400,
      "Provider không thuộc danh sách máy chủ được phép.",
    );
  if (isIP(host) && !publicAddress(host))
    throw new ApiError(400, "Không cho phép địa chỉ nội bộ.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${endpoint}`;
  return url;
}
export type ProviderTransport = (
  url: URL,
  apiKey: string,
  body: unknown | undefined,
  signal: AbortSignal,
) => Promise<Response>;
// DNS is resolved once and pinned in the actual TLS connection; no redirect is followed.
export const secureTransport: ProviderTransport = async (
  url,
  apiKey,
  body,
  signal,
) => {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => !publicAddress(x.address)))
    throw new ApiError(
      400,
      "Provider trỏ tới địa chỉ không được phép.",
      "AI_UNSAFE_HOST",
    );
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: body === undefined ? "GET" : "POST",
        signal,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400) {
          res.destroy();
          reject(new ApiError(502, "Provider redirect bị chặn."));
          return;
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status: res.statusCode ?? 502,
            headers: {
              "content-type": String(res.headers["content-type"] ?? ""),
            },
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
};
export async function boundedJson(
  response: Response,
  max = 2000000,
): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "Provider không trả dữ liệu.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > max) throw new ApiError(502, "Phản hồi provider quá lớn.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new ApiError(502, "Provider trả dữ liệu JSON không hợp lệ.");
  }
}
export async function streamCompletion(
  response: Response,
  onText: (text: string) => Promise<void>,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "Provider không trả stream.");
  const decoder = new TextDecoder();
  let buffer = "",
    bytes = 0,
    content = "",
    usage: any,
    finished = false;
  const dispatch = async (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ApiError(502, "Stream provider không hợp lệ.");
    }
    if (parsed.error)
      throw new ApiError(502, "Provider lỗi trong quá trình trả lời.");
    if (parsed.usage) usage = parsed.usage;
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== "stop")
      throw new ApiError(
        502,
        "Câu trả lời chưa hoàn chỉnh; hãy giảm phạm vi hoặc tăng giới hạn output.",
        "AI_INCOMPLETE",
      );
    if (choice?.delta?.tool_calls)
      throw new ApiError(502, "Provider gửi công cụ ngoài vòng xử lý.");
    const delta = choice?.delta?.content;
    if (typeof delta === "string") {
      content += delta;
      await onText(content);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      bytes += value?.length ?? 0;
      if (bytes > 2000000 || buffer.length > 200000)
        throw new ApiError(502, "Stream provider quá lớn.");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        await dispatch(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) break;
    }
    if (buffer.trim()) await dispatch(buffer);
    if (!finished || !content.trim())
      throw new ApiError(
        502,
        "Provider kết thúc trước khi hoàn tất câu trả lời.",
        "AI_INCOMPLETE",
      );
    return { content, usage };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
