import { ApiError } from "../errors.js";
import type { LookupFetch } from "./lookup.js";
import { metaText } from "./review.js";

// Mirror plot of the GNPS2 query spectrum against the matched library
// spectrum, rendered by the Metabolomics USI service (fixed host).
const HOST = "https://metabolomics-usi.gnps2.org";
const MAX_BYTES = 1_500_000;
export const defaultSpectrumFetch: LookupFetch = (url, signal) =>
  fetch(url, { signal, redirect: "error", headers: { accept: "image/png" } });

export function gnpsTask(data: any, sourceUrl: string | null) {
  if (typeof data?.task === "string" && /^[a-f0-9]{32}$/i.test(data.task))
    return data.task.toLowerCase();
  try {
    const task = sourceUrl ? new URL(sourceUrl).searchParams.get("task") : null;
    return task && /^[a-f0-9]{32}$/i.test(task) ? task.toLowerCase() : null;
  } catch {
    return null;
  }
}
export function mirrorSpec(task: string | null, row: Record<string, any>) {
  const scan = metaText(row, "#Scan#", "scan"),
    spectrumId = metaText(row, "SpectrumID");
  if (!task || !scan || !/^\d{1,9}$/.test(scan))
    throw new ApiError(
      400,
      "Dòng này không có task GNPS2 và scan để dựng mirror plot (chỉ báo cáo nhập từ GNPS2 Task có).",
      "AI_NO_SPECTRUM",
    );
  if (!spectrumId || !/^CCMSLIB\d{8,14}$/.test(spectrumId))
    throw new ApiError(
      400,
      "Dòng này không có SpectrumID thư viện GNPS để so phổ.",
      "AI_NO_SPECTRUM",
    );
  return {
    scan,
    spectrumId,
    usi1: `mzspec:GNPS2:TASK-${task}-nf_output/clustering/specs_ms.mgf:scan:${scan}`,
    usi2: `mzspec:GNPS:GNPS-LIBRARY:accession:${spectrumId}`,
  };
}
export async function fetchMirrorPng(
  spec: { usi1: string; usi2: string },
  fetcher: LookupFetch = defaultSpectrumFetch,
) {
  const url = `${HOST}/png/mirror/?usi1=${encodeURIComponent(spec.usi1)}&usi2=${encodeURIComponent(spec.usi2)}`;
  let response: Response;
  try {
    response = await fetcher(url, AbortSignal.timeout(20000));
  } catch {
    throw new ApiError(502, "Không tải được ảnh mirror plot từ GNPS2.");
  }
  if (
    !response.ok ||
    !String(response.headers.get("content-type")).startsWith("image/png")
  ) {
    await response.body?.cancel();
    throw new ApiError(
      502,
      `GNPS2 không trả ảnh mirror plot (HTTP ${response.status}).`,
    );
  }
  const reader = response.body?.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ApiError(502, "Ảnh mirror plot quá lớn.");
    }
    parts.push(value);
  }
  return `data:image/png;base64,${Buffer.concat(parts).toString("base64")}`;
}
