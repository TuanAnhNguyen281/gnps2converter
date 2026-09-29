import { v2 as cloudinary } from "cloudinary";
import JSZip from "jszip";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";
export interface MediaInput {
  name: string;
  kind: string;
  bytes: Buffer;
  mime: string;
  rowId?: string;
}
export interface CloudAsset {
  public_id: string;
  resource_type: string;
  delivery_type: string;
  original_name: string;
  mime: string;
  bytes: number;
}
export interface MediaProvider {
  upload(
    publicId: string,
    input: MediaInput,
    resourceType: "image" | "raw",
  ): Promise<{ assetId: string; version: string }>;
  download(asset: CloudAsset): Promise<Buffer>;
  destroy(asset: CloudAsset): Promise<void>;
}
export async function validateFile(input: MediaInput, config: Config) {
  const ext = input.name.split(".").pop()?.toLowerCase(),
    image = input.kind === "structure";
  if (
    !input.bytes.length ||
    input.bytes.length > (image ? config.maxImageBytes : config.maxFileBytes)
  )
    throw new ApiError(
      413,
      "Ảnh/file vượt giới hạn lưu Cloudinary.",
      "FILE_LIMIT",
    );
  if (image) {
    const b = input.bytes,
      png = b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      jpg = b[0] === 255 && b[1] === 216 && b[2] === 255,
      webp =
        b.subarray(0, 4).toString() === "RIFF" &&
        b.subarray(8, 12).toString() === "WEBP";
    if (
      !(png && input.mime === "image/png" && ext === "png") &&
      !(
        jpg &&
        input.mime === "image/jpeg" &&
        ["jpg", "jpeg"].includes(ext ?? "")
      ) &&
      !(webp && input.mime === "image/webp" && ext === "webp")
    )
      throw new ApiError(400, "Chỉ hỗ trợ ảnh PNG/JPEG/WebP hợp lệ.");
  } else {
    const allowed: Record<string, string[]> = {
      source_tsv: ["tsv"],
      source_xlsx: ["xlsx"],
      gnps_matches: ["json", "tsv"],
      gnps_graphml: ["graphml"],
      gnps_mgf: ["mgf", "json"],
      export_docx: ["docx"],
      export_xlsx: ["xlsx"],
    };
    if (!allowed[input.kind]?.includes(ext ?? ""))
      throw new ApiError(400, "Loại file không thuộc nghiệp vụ cho phép.");
    if (ext === "xlsx" || ext === "docx") {
      const zip = await JSZip.loadAsync(input.bytes);
      let total = 0;
      for (const file of Object.values(zip.files)) {
        total += Number(
          (file as unknown as { _data?: { uncompressedSize?: number } })._data
            ?.uncompressedSize ?? 0,
        );
        if (total > 50_000_000)
          throw new ApiError(413, "Nội dung giải nén vượt giới hạn.");
      }
      if (
        Object.keys(zip.files).length > 2000 ||
        !zip.file("[Content_Types].xml") ||
        !zip.file(ext === "xlsx" ? "xl/workbook.xml" : "word/document.xml")
      )
        throw new ApiError(400, "File Office không hợp lệ.");
    } else {
      const text = input.bytes.toString("utf8");
      if (
        text.includes("\0") ||
        /<!DOCTYPE|<!ENTITY/i.test(text) ||
        /^\s*<(?:html|script)/i.test(text)
      )
        throw new ApiError(400, "File văn bản/XML không hợp lệ.");
      if (ext === "json") JSON.parse(text);
    }
  }
}
export function imageInput(data: string, rowId: string): MediaInput {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    data,
  );
  if (!m) throw new ApiError(400, "Ảnh cấu trúc không hợp lệ.");
  return {
    name: `${rowId}.${m[1] === "jpeg" ? "jpg" : m[1]}`,
    kind: "structure",
    mime: `image/${m[1]}`,
    bytes: Buffer.from(m[2], "base64"),
    rowId,
  };
}
export function cloudinaryProvider(config: Config): MediaProvider {
  const settings = {
    cloud_name: config.cloudName,
    api_key: config.cloudKey,
    api_secret: config.cloudSecret,
    secure: true,
  };
  const available = () => {
    if (!config.cloudName || !config.cloudKey || !config.cloudSecret)
      throw new ApiError(
        503,
        "Cloudinary chưa được cấu hình. Kết quả đã lưu, ảnh/file chưa lưu đủ.",
        "CLOUD_UNAVAILABLE",
      );
  };
  return {
    async upload(publicId, input, resourceType) {
      available();
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            ...settings,
            public_id: publicId,
            resource_type: resourceType,
            type: "authenticated",
            overwrite: false,
            timeout: 60000,
          },
          (error, result) => {
            if (error || !result)
              return reject(
                new ApiError(
                  502,
                  "Không lưu được tài sản lên Cloudinary.",
                  "CLOUD_UPLOAD_FAILED",
                ),
              );
            resolve({
              assetId: result.asset_id,
              version: String(result.version),
            });
          },
        );
        stream.on("error", () =>
          reject(new ApiError(502, "Upload Cloudinary bị gián đoạn.")),
        );
        stream.end(input.bytes);
      });
    },
    async download(asset) {
      available();
      const format = asset.original_name.split(".").pop() ?? "";
      const url = cloudinary.utils.private_download_url(
        asset.public_id,
        asset.resource_type === "raw" ? "" : format,
        {
          ...settings,
          resource_type: asset.resource_type,
          type: "authenticated",
          expires_at: Math.floor(Date.now() / 1000) + 60,
        },
      );
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!response.ok || !response.body)
        throw new ApiError(502, "Không tải được tài sản Cloudinary.");
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > Math.max(config.maxFileBytes, config.maxImageBytes))
          throw new ApiError(413, "File cloud vượt giới hạn.");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
    async destroy(asset) {
      available();
      const result = await cloudinary.uploader.destroy(asset.public_id, {
        ...settings,
        resource_type: asset.resource_type,
        type: "authenticated",
        invalidate: true,
      });
      if (!["ok", "not found"].includes(result.result))
        throw new ApiError(502, "Chưa xóa được tài sản Cloudinary.");
    },
  };
}
