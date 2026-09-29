import { randomUUID, createHash } from "node:crypto";
import type { Database, Connection } from "../db/index.js";
import { transaction } from "../db/index.js";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";
import { imageInput, type MediaInput } from "../media/provider.js";
import type { MediaService } from "../media/service.js";
import { validateResult, type Result } from "./validation.js";
import { emitProgress, type ProgressReporter } from "../progress.js";
export interface MediaFailure {
  name: string;
  kind: string;
  rowId?: string;
  hash?: string;
  message: string;
}
export interface Report {
  id: string;
  owner_id: string;
  title: string;
  data: Omit<Result, "rows">;
  revision: number;
  media_status: string;
  media_errors: MediaFailure[];
  source_url: string;
  updated_at: string | Date;
}
async function writeRows(c: Connection, id: string, rows: Result["rows"]) {
  await c.query("DELETE FROM report_rows WHERE report_id=$1", [id]);
  if (!rows.length) return;
  const records = rows.map(
    (
      {
        structureData: _img,
        structureUrl: _url,
        id: sourceId,
        compoundName,
        status,
        selected,
        ...payload
      },
      position,
    ) => ({
      id: randomUUID(),
      report_id: id,
      source_row_id: sourceId,
      position,
      compound_name: compoundName,
      status,
      selected,
      payload,
    }),
  );
  await c.query(
    "INSERT INTO report_rows SELECT * FROM jsonb_populate_recordset(NULL::report_rows,$1::jsonb)",
    [JSON.stringify(records)],
  );
}
export class ReportService {
  constructor(
    public db: Database,
    public config: Config,
    public media: MediaService,
  ) {}
  async metadata(userId: string, id: string) {
    const report = (
      await this.db.query<Report>(
        "SELECT * FROM reports WHERE id=$1 AND owner_id=$2",
        [id, userId],
      )
    ).rows[0];
    if (!report) throw new ApiError(404, "Không tìm thấy báo cáo.");
    return report;
  }
  async create(
    userId: string,
    title: string,
    raw: unknown,
    key: string,
    sourceUrl?: string,
    files: MediaInput[] = [],
    progress?: ProgressReporter,
  ) {
    const { result, bytes } = validateResult(raw, this.config),
      { rows, ...data } = result;
    emitProgress(progress, {
      stage: "database", step: 5, percent: 69,
      title: "Đang lưu báo cáo vào database",
      message: `Đang lưu ${rows.length} dòng kết quả vào PostgreSQL.`,
      current: 0, total: rows.length,
    });
    const outcome = await transaction(this.db, async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const old = (
        await c.query<Report>(
          "SELECT * FROM reports WHERE owner_id=$1 AND idempotency_key=$2",
          [userId, key],
        )
      ).rows[0];
      if (old) return { report: old, fresh: false };
      const count = Number(
        (
          await c.query("SELECT count(*) FROM reports WHERE owner_id=$1", [
            userId,
          ])
        ).rows[0].count,
      );
      if (count >= this.config.maxReports)
        throw new ApiError(
          409,
          "Đã đạt giới hạn số báo cáo. Hãy xóa báo cáo cũ.",
          "REPORT_QUOTA",
        );
      const report = (
        await c.query<Report>(
          "INSERT INTO reports(id,owner_id,title,data,source_url,row_count,storage_bytes,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            userId,
            title,
            JSON.stringify(data),
            sourceUrl ?? null,
            rows.length,
            bytes,
            key,
          ],
        )
      ).rows[0];
      await writeRows(c, report.id, rows);
      return { report, fresh: true };
    });
    emitProgress(progress, {
      stage: "database", step: 5, percent: 75,
      title: outcome.fresh ? "Đã lưu dữ liệu vào PostgreSQL" : "Báo cáo đã được lưu trước đó",
      message: outcome.fresh
        ? `Đã lưu báo cáo cùng ${rows.length} dòng kết quả.`
        : "Đang dùng báo cáo đã lưu từ yêu cầu trước đó.",
      current: rows.length, total: rows.length, succeeded: rows.length,
      outcome: "success",
    });
    let warning: string | undefined;
    if (outcome.fresh) {
      warning = await this.persistMedia(userId, outcome.report.id, rows, files, progress);
    } else {
      emitProgress(progress, {
        stage: "assets", step: 6, percent: 99,
        title: "Ảnh và file đã được lưu trước đó",
        message: "Báo cáo trùng yêu cầu nên không tải lại các tài nguyên.",
        current: 0, total: 0, succeeded: 0, outcome: "success",
      });
    }
    return {
      ...(await this.get(userId, outcome.report.id)),
      saveWarning: warning,
    };
  }
  async persistMedia(
    userId: string,
    id: string,
    rows: Result["rows"],
    files: MediaInput[] = [],
    progress?: ProgressReporter,
  ) {
    const previous = (await this.metadata(userId, id)).media_errors;
    const rowIds = new Set(
      (
        await this.db.query(
          "SELECT source_row_id FROM report_rows WHERE report_id=$1",
          [id],
        )
      ).rows.map((r) => r.source_row_id),
    );
    const failures = previous.filter((f) => !f.rowId || rowIds.has(f.rowId));
    const inputs = [...files];
    for (const row of rows)
      if (row.structureData?.startsWith("data:")) {
        try {
          inputs.push(imageInput(row.structureData, row.id));
        } catch {
          failures.push({
            name: row.id,
            kind: "structure",
            rowId: row.id,
            message: "Ảnh cấu trúc không hợp lệ.",
          });
        }
      }
    const imageTotal = inputs.filter((input) => input.kind === "structure").length;
    const fileTotal = inputs.length - imageTotal;
    let imageDone = 0;
    let fileDone = 0;
    let completed = 0;
    let uploadFailures = 0;
    const assetMessage = (input: MediaInput, current: number) =>
      input.kind === "structure"
        ? `Ảnh cấu trúc ${current}/${imageTotal} · ${input.name}`
        : `File nguồn ${current}/${fileTotal} · ${input.name}`;
    emitProgress(progress, {
      stage: "assets", step: 6, percent: 77,
      title: "Đang chuẩn bị lưu ảnh và file",
      message: imageTotal || fileTotal
        ? `Chuẩn bị ${imageTotal} ảnh cấu trúc và ${fileTotal} file nguồn.`
        : "Báo cáo không có ảnh hoặc file nguồn cần tải lên.",
      current: 0, total: inputs.length, succeeded: 0, failed: failures.length,
      outcome: "working",
    });
    for (const input of inputs) {
      const categoryCurrent = input.kind === "structure" ? imageDone + 1 : fileDone + 1;
      const percentBefore = inputs.length ? Math.round(77 + 21 * completed / inputs.length) : 98;
      emitProgress(progress, {
        stage: "assets", step: 6, percent: percentBefore,
        title: input.kind === "structure" ? "Đang lưu ảnh cấu trúc lên Cloudinary" : "Đang lưu file nguồn lên Cloudinary",
        message: assetMessage(input, categoryCurrent),
        detail: `${completed}/${inputs.length} tài nguyên đã xử lý`,
        current: completed + 1, total: inputs.length,
        succeeded: completed - uploadFailures, failed: uploadFailures,
        outcome: "working",
      });
      for (let i = failures.length - 1; i >= 0; i--)
        if (
          failures[i].kind === input.kind &&
          (input.rowId
            ? failures[i].rowId === input.rowId
            : failures[i].name === input.name)
        )
          failures.splice(i, 1);
      try {
        await this.media.attach(userId, id, input);
        if (input.kind === "structure") imageDone += 1;
        else fileDone += 1;
      } catch (error) {
        uploadFailures += 1;
        if (input.kind === "structure") imageDone += 1;
        else fileDone += 1;
        failures.push({
          name: input.name,
          kind: input.kind,
          rowId: input.rowId,
          hash: createHash("sha256").update(input.bytes).digest("hex"),
          message:
            error instanceof ApiError
              ? error.message
              : "Có ảnh/file chưa lưu được.",
        });
      }
      completed += 1;
      emitProgress(progress, {
        stage: "assets", step: 6,
        percent: inputs.length ? Math.round(77 + 21 * completed / inputs.length) : 98,
        title: input.kind === "structure" ? "Đã xử lý ảnh cấu trúc" : "Đã xử lý file nguồn",
        message: `${assetMessage(input, input.kind === "structure" ? imageDone : fileDone)} · ${uploadFailures ? `lỗi ${uploadFailures}` : "đã lưu"}`,
        detail: `${completed}/${inputs.length} tài nguyên · ${completed - uploadFailures} thành công · ${uploadFailures} lỗi`,
        current: completed, total: inputs.length,
        succeeded: completed - uploadFailures, failed: uploadFailures,
        outcome: uploadFailures ? "partial" : "success",
      });
    }
    const pending = (await this.media.list(userId, id)).some(
      (a) => a.state !== "ready",
    );
    await this.db.query(
      "UPDATE reports SET media_status=$2,media_errors=$4 WHERE id=$1 AND owner_id=$3",
      [
        id,
        failures.length || pending ? "failed" : "ready",
        userId,
        JSON.stringify(failures),
      ],
    );
    emitProgress(progress, {
      stage: "assets", step: 6, percent: 99,
      title: failures.length || pending ? "Đã hoàn tất, còn tài nguyên cần kiểm tra" : "Đã lưu xong ảnh và file",
      message: `${imageDone} ảnh cấu trúc · ${fileDone} file nguồn · ${failures.length} mục lỗi.`,
      detail: failures.length ? failures[0].message : undefined,
      current: completed, total: inputs.length,
      succeeded: Math.max(0, completed - uploadFailures), failed: failures.length,
      outcome: failures.length || pending ? "partial" : "success",
    });
    return failures[0]?.message;
  }
  async get(userId: string, id: string, forExport = false) {
    const { report, stored, assets } = await transaction(this.db, async (c) => {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const report = (
        await c.query<Report>(
          "SELECT * FROM reports WHERE id=$1 AND owner_id=$2",
          [id, userId],
        )
      ).rows[0];
      if (!report) throw new ApiError(404, "Không tìm thấy báo cáo.");
      const stored = (
        await c.query(
          "SELECT * FROM report_rows WHERE report_id=$1 ORDER BY position",
          [id],
        )
      ).rows;
      const assets = (
        await c.query<import("../media/service.js").Asset>(
          "SELECT a.*,ra.kind,ra.row_id,ra.report_revision FROM media_assets a JOIN report_assets ra ON ra.asset_id=a.id WHERE ra.report_id=$1 AND a.owner_id=$2",
          [id, userId],
        )
      ).rows;
      return { report, stored, assets };
    });
    const rows: Result["rows"] = [];
    for (const r of stored) {
      const row = {
        ...r.payload,
        id: r.source_row_id,
        compoundName: r.compound_name,
        status: r.status,
        selected: r.selected,
      } as Result["rows"][number];
      const a = assets.find(
        (a) =>
          a.kind === "structure" && a.row_id === row.id && a.state === "ready",
      );
      if (a)
        row.structureData = forExport
          ? `data:${a.mime};base64,${(await this.media.provider.download(a)).toString("base64")}`
          : `/api/reports/${id}/assets/${a.id}/download`;
      rows.push(row);
    }
    return {
      ...report.data,
      title: report.title,
      rows,
      reportId: id,
      revision: report.revision,
      sourceUrl: report.source_url,
      updatedAt: new Date(report.updated_at).toISOString(),
      mediaStatus: report.media_status,
      mediaErrors: report.media_errors,
    };
  }
  async update(
    userId: string,
    id: string,
    title: string,
    raw: unknown,
    revision: number,
  ) {
    const { result, bytes } = validateResult(raw, this.config),
      { rows, ...data } = result;
    const next = await transaction(this.db, async (c) => {
      const report = (
        await c.query<Report>(
          "SELECT * FROM reports WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, userId],
        )
      ).rows[0];
      if (!report) throw new ApiError(404, "Không tìm thấy báo cáo.");
      if (report.revision !== revision)
        throw new ApiError(
          409,
          "Báo cáo đã thay đổi ở tab/thiết bị khác. Tải lại trước khi lưu.",
          "REVISION_CONFLICT",
        );
      if (report.media_status === "pending")
        throw new ApiError(
          409,
          "Báo cáo đang lưu ảnh/file. Hãy thử lại.",
          "REPORT_BUSY",
        );
      const updated = await c.query<{ updated_at: string | Date }>(
        "UPDATE reports SET title=$3,data=$4,revision=revision+1,row_count=$5,storage_bytes=$6,updated_at=now(),media_status='pending' WHERE id=$1 AND owner_id=$2 RETURNING updated_at",
        [id, userId, title, JSON.stringify(data), rows.length, bytes],
      );
      await writeRows(c, id, rows);
      await c.query(
        "DELETE FROM report_assets WHERE report_id=$1 AND kind='structure' AND NOT(row_id=ANY($2::text[]))",
        [id, rows.filter((r) => r.structureData).map((r) => r.id)],
      );
      return {
        revision: revision + 1,
        updatedAt: new Date(updated.rows[0].updated_at).toISOString(),
      };
    });
    const warning = await this.persistMedia(userId, id, rows);
    return { ...next, saveWarning: warning };
  }
  async remove(userId: string, id: string) {
    const d = await this.db.query(
      "DELETE FROM reports WHERE id=$1 AND owner_id=$2 RETURNING id",
      [id, userId],
    );
    if (!d.rowCount) throw new ApiError(404, "Không tìm thấy báo cáo.");
  }
}
