// Deterministic "needs review" score for a library-match row. The model only
// explains these numbers; it never decides them.
export interface ReviewResult {
  score: number;
  reasons: string[];
}
export interface ReviewParameters {
  mzMode?: "ppm" | "da";
  mzTolerance?: number;
  rtTolerance?: number;
}
const normal = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
export function metaNumber(row: Record<string, any>, ...keys: string[]) {
  const wanted = new Set(keys.map(normal));
  for (const [k, v] of Object.entries(row.sourceMetadata ?? {})) {
    if (!wanted.has(normal(k))) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
export function metaText(row: Record<string, any>, ...keys: string[]) {
  const wanted = new Set(keys.map(normal));
  for (const [k, v] of Object.entries(row.sourceMetadata ?? {}))
    if (wanted.has(normal(k)) && v !== null && String(v).trim())
      return String(v).trim();
  return null;
}
export const ppmOf = (row: Record<string, any>) => {
  const v = row.reportedMzErrorPpm ?? row.deltaPpm;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
export function reviewRow(
  row: Record<string, any>,
  parameters: ReviewParameters = {},
): ReviewResult {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (row.status === "unmatched") add(35, "Không khớp feature trong dữ liệu");
  else if (row.status === "ambiguous")
    add(25, "Khớp chưa chắc chắn (RT lấy từ RT_Query hoặc nhiều ứng viên)");
  const ppmLimit =
    parameters.mzMode === "ppm" && parameters.mzTolerance
      ? parameters.mzTolerance
      : 10;
  const ppm = ppmOf(row);
  if (ppm !== null && Math.abs(ppm) > ppmLimit)
    add(
      Math.abs(ppm) > 2 * ppmLimit ? 30 : 20,
      `Sai số ${ppm.toFixed(1)} ppm vượt ngưỡng ${ppmLimit} ppm`,
    );
  const candidates = Number(row.candidateCount);
  if (Number.isFinite(candidates) && candidates > 1)
    add(Math.min(20, 5 * candidates), `${candidates} ứng viên cùng m/z`);
  const mq = metaNumber(row, "MQScore", "cosine");
  if (mq !== null && mq < 0.7)
    add(mq < 0.6 ? 25 : 15, `MQScore thấp (${mq.toFixed(2)})`);
  const shared = metaNumber(row, "SharedPeaks");
  if (shared !== null && shared < 6)
    add(15, `Chỉ ${shared} peak trùng với phổ thư viện`);
  const deltaRt = Number(row.deltaRt);
  if (
    parameters.rtTolerance &&
    Number.isFinite(deltaRt) &&
    Math.abs(deltaRt) > parameters.rtTolerance
  )
    add(
      15,
      `Lệch RT ${deltaRt.toFixed(2)} vượt ngưỡng ${parameters.rtTolerance}`,
    );
  if (!metaText(row, "Smiles", "InChIKey", "INCHI"))
    add(5, "Không có SMILES/InChIKey để kiểm tra cấu trúc");
  return { score: Math.min(100, score), reasons };
}
export const REVIEW_RULE =
  "Điểm 0-100 do server tính: unmatched +35, ambiguous +25, ppm vượt ngưỡng +20/+30, nhiều ứng viên +5/ứng viên (tối đa 20), MQScore <0.7 +15 (<0.6 +25), SharedPeaks <6 +15, lệch RT vượt ngưỡng +15, thiếu SMILES/InChIKey +5. Điểm cao = nên duyệt trước; không phải kết luận định danh.";
