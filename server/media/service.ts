import { randomUUID, createHash } from "node:crypto";
import type { Database } from "../db/index.js";
import { transaction } from "../db/index.js";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";
import {
  validateFile,
  type MediaInput,
  type MediaProvider,
  type CloudAsset,
} from "./provider.js";
export interface Asset extends CloudAsset {
  id: string;
  owner_id: string;
  state: string;
  hash: string;
  kind?: string;
  row_id?: string;
  report_revision?: number;
}
export class MediaService {
  constructor(
    public db: Database,
    public config: Config,
    public provider: MediaProvider,
  ) {}
  async attach(
    userId: string,
    reportId: string,
    input: MediaInput,
    revision?: number,
  ) {
    await validateFile(input, this.config);
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    const asset = await transaction(this.db, async (c) => {
      const u = (
        await c.query("SELECT cloud_bytes FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ])
      ).rows[0];
      if (
        !(
          await c.query("SELECT id FROM reports WHERE id=$1 AND owner_id=$2", [
            reportId,
            userId,
          ])
        ).rowCount
      )
        throw new ApiError(404, "Không tìm thấy báo cáo.");
      const type = input.kind === "structure" ? "image" : "raw";
      let current = (
        await c.query<Asset>(
          "SELECT * FROM media_assets WHERE owner_id=$1 AND hash=$2 AND state IN ('ready','failed') AND resource_type=$3 AND ($3='image' OR original_name=$4) ORDER BY created_at DESC LIMIT 1",
          [userId, hash, type, input.name],
        )
      ).rows[0];
      if (!current) {
        if (
          Number(u.cloud_bytes) + input.bytes.length >
          this.config.maxCloudBytes
        )
          throw new ApiError(
            409,
            "Đã hết dung lượng ảnh/file của tài khoản.",
            "CLOUD_QUOTA",
          );
        const id = randomUUID(),
          ext = input.name.split(".").pop()?.toLowerCase(),
          publicId = `gnps2/${userId}/${id}${type === "image" ? "" : `.${ext}`}`;
        current = (
          await c.query<Asset>(
            "INSERT INTO media_assets(id,owner_id,public_id,resource_type,original_name,mime,bytes,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              id,
              userId,
              publicId,
              type,
              input.name,
              input.mime,
              input.bytes.length,
              hash,
            ],
          )
        ).rows[0];
        await c.query(
          "UPDATE users SET cloud_bytes=cloud_bytes+$1 WHERE id=$2",
          [input.bytes.length, userId],
        );
      }
      if (input.rowId)
        await c.query(
          "DELETE FROM report_assets WHERE report_id=$1 AND kind='structure' AND row_id=$2",
          [reportId, input.rowId],
        );
      await c.query(
        "INSERT INTO report_assets(id,report_id,asset_id,kind,row_id,report_revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          reportId,
          current.id,
          input.kind,
          input.rowId ?? null,
          revision ?? null,
        ],
      );
      return current;
    });
    if (asset.state === "ready") return asset.id;
    try {
      const result = await this.provider.upload(
        asset.public_id,
        input,
        asset.resource_type as "image" | "raw",
      );
      await this.db.query(
        "UPDATE media_assets SET state='ready',cloud_asset_id=$2,version=$3 WHERE id=$1 AND state IN ('pending','failed')",
        [asset.id, result.assetId, result.version],
      );
      return asset.id;
    } catch (error) {
      await this.db.query(
        "UPDATE media_assets SET state='failed' WHERE id=$1 AND state IN ('pending','failed')",
        [asset.id],
      );
      throw error;
    }
  }
  async list(userId: string, reportId: string) {
    return (
      await this.db.query<Asset>(
        "SELECT a.*,ra.kind,ra.row_id,ra.report_revision FROM media_assets a JOIN report_assets ra ON ra.asset_id=a.id JOIN reports r ON r.id=ra.report_id WHERE r.id=$1 AND r.owner_id=$2 AND a.owner_id=$2 ORDER BY a.created_at",
        [reportId, userId],
      )
    ).rows;
  }
  async get(userId: string, reportId: string, id: string) {
    const a = (await this.list(userId, reportId)).find((a) => a.id === id);
    if (!a) throw new ApiError(404, "Không tìm thấy ảnh/file.");
    return a;
  }
  async download(userId: string, reportId: string, id: string) {
    const asset = await this.get(userId, reportId, id);
    if (asset.state !== "ready")
      throw new ApiError(
        409,
        "Ảnh/file chưa lưu đầy đủ. Hãy thử lại hoặc upload lại.",
        "ASSET_NOT_READY",
      );
    return { asset, bytes: await this.provider.download(asset) };
  }
  async trimExports(reportId: string) {
    await this.db.query(
      "DELETE FROM report_assets WHERE id IN (SELECT id FROM report_assets WHERE report_id=$1 AND kind IN ('export_docx','export_xlsx') ORDER BY report_revision DESC,id DESC OFFSET 5)",
      [reportId],
    );
  }
  async cleanup() {
    await this.db.query(
      "UPDATE media_assets SET state='failed' WHERE state='pending' AND created_at<now()-interval '10 minutes'",
    );
    await this.db.query(
      "UPDATE reports SET media_status='failed' WHERE media_status='pending' AND updated_at<now()-interval '10 minutes'",
    );
    const possible = (
      await this.db.query<Asset>(
        "SELECT * FROM media_assets WHERE state IN ('ready','failed','deleting') AND next_attempt_at<=now() AND NOT EXISTS(SELECT 1 FROM report_assets ra WHERE ra.asset_id=media_assets.id) ORDER BY owner_id,created_at LIMIT 5",
      )
    ).rows;
    const candidates: Asset[] = [];
    for (const a of possible) {
      const claimed = await transaction(this.db, async (c) => {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          a.owner_id,
        ]);
        const fresh = (
          await c.query<Asset>(
            "UPDATE media_assets SET state='deleting',next_attempt_at=now()+interval '5 minutes' WHERE id=$1 AND state IN ('ready','failed','deleting') AND next_attempt_at<=now() AND NOT EXISTS(SELECT 1 FROM report_assets ra WHERE ra.asset_id=media_assets.id) RETURNING *",
            [a.id],
          )
        ).rows[0];
        return fresh;
      });
      if (claimed) candidates.push(claimed);
    }
    for (const a of candidates) {
      try {
        await this.provider.destroy(a);
        await transaction(this.db, async (c) => {
          const changed = await c.query(
            "UPDATE media_assets SET state='deleted' WHERE id=$1 AND state='deleting' RETURNING id",
            [a.id],
          );
          if (changed.rowCount)
            await c.query(
              "UPDATE users SET cloud_bytes=greatest(0,cloud_bytes-$1) WHERE id=$2",
              [Number(a.bytes), a.owner_id],
            );
        });
      } catch {
        await this.db.query(
          "UPDATE media_assets SET attempts=attempts+1,next_attempt_at=now()+interval '15 minutes' WHERE id=$1",
          [a.id],
        );
      }
    }
    await this.db.query("DELETE FROM sessions WHERE expire<now()");
  }
}
