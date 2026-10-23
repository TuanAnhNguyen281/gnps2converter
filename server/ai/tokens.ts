// Token estimate without the model's tokenizer. BPE vocabularies spend about one
// token per 3-4 ASCII characters but often one per 1-2 accented Vietnamese
// characters, so the two are weighted separately and rounded up.
export const ESTIMATOR_VERSION = "heuristic-v1";
export function estimateTextTokens(text: string) {
  let ascii = 0,
    other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other / 1.5);
}
// Providers bill an image by its tiles, not its base64 length; a mirror plot
// is about this size at "auto" detail.
export const IMAGE_TOKENS = 1100;
// JSON for size/budget checks with inline image data replaced by a marker.
export const withoutImages = (value: unknown) =>
  JSON.stringify(value, (key, v) =>
    key === "url" && typeof v === "string" && v.startsWith("data:image/")
      ? "<image>"
      : v,
  );
const imageCount = (m: any) =>
  Array.isArray(m?.content)
    ? m.content.filter((part: any) => part?.type === "image_url").length
    : 0;
// Chat framing adds a few tokens per message; tool schemas are sent as JSON.
export function estimatePromptTokens(messages: unknown[], tools?: unknown) {
  return (
    messages.reduce<number>(
      (n, m) =>
        n +
        4 +
        estimateTextTokens(withoutImages(m)) +
        imageCount(m) * IMAGE_TOKENS,
      3,
    ) + (tools ? estimateTextTokens(JSON.stringify(tools)) : 0)
  );
}
// calibration = observed provider input / our estimate for this model (EMA).
// A 15% margin keeps the calibrated figure on the safe side.
export function calibrate(estimate: number, calibration: unknown) {
  const c = Number(calibration);
  if (!Number.isFinite(c) || c <= 0) return estimate;
  return Math.ceil(estimate * Math.min(3, Math.max(0.5, c * 1.15)));
}
export function nextCalibration(
  previous: unknown,
  actualInput: number,
  estimatedInput: number,
) {
  if (estimatedInput <= 0 || actualInput <= 0) return null;
  const ratio = Math.min(3, Math.max(0.3, actualInput / estimatedInput)),
    p = Number(previous);
  return Number(
    (Number.isFinite(p) && p > 0 ? p * 0.7 + ratio * 0.3 : ratio).toFixed(4),
  );
}
