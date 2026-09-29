import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { z } from "zod";
import { aliases, guessColumn, matchRows } from "./matching.js";
import { importGnpsTask } from "./gnps-task.js";
import { previewTsv, previewXlsx } from "./file-preview.js";
import type { ColumnMapping, MatchRow, RawRow } from "./types.js";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Database } from "./db/index.js";
import { ApiError, owner, route } from "./errors.js";
import { PostgresSessionStore } from "./auth/session.js";
import { authRouter, validCsrf } from "./auth/routes.js";
import {
  cloudinaryProvider,
  validateFile,
  type MediaInput,
  type MediaProvider,
} from "./media/provider.js";
import { MediaService } from "./media/service.js";
import { ReportService } from "./reports/service.js";
import type { PipelineProgress, ProgressReporter } from "./progress.js";

export function createApp(
  config: Config,
  db?: Database,
  provider?: MediaProvider,
) {
  const media = db
    ? new MediaService(db, config, provider ?? cloudinaryProvider(config))
    : undefined;
  const reports =
    db && media ? new ReportService(db, config, media) : undefined;

  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (_req, file, callback) => {
      const decoded = Buffer.from(file.originalname, "latin1").toString("utf8");
      if (!decoded.includes("\uFFFD")) file.originalname = decoded;
      callback(null, true);
    },
    limits: { fileSize: config.maxFileBytes, files: 3, fields: 12, parts: 15 },
  });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  const require = createRequire(import.meta.url);

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );
  app.use(express.json({ limit: "15mb" }));

  const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? config.origin)
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  app.use((request, response, next) => {
    const origin = request.headers.origin?.replace(/\/$/, "");
    const isLocal =
      !config.production &&
      !!origin &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (origin && !isLocal && !frontendOrigins.includes(origin)) {
      return response
        .status(403)
        .json({ message: "Origin không được phép truy cập API." });
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,DELETE,OPTIONS",
      );
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,X-CSRF-Token,Idempotency-Key",
      );
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Expose-Headers", "X-Archive-Status");
      response.setHeader("Access-Control-Max-Age", "86400");
    }
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  function safeName(input: string) {
    return (
      input
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .trim()
        .slice(0, 100) || "report"
    );
  }

  function contentDisposition(fileName: string) {
    const asciiName =
      fileName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "_")
        .replace(/["\\]/g, "_") || "report";
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }

  function rowsFromWorksheet(worksheet: ExcelJS.Worksheet): {
    headers: string[];
    rows: RawRow[];
  } {
    const headers: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
      headers[column - 1] =
        String(cell.text ?? "").trim() || `Column_${column}`;
    });
    const rows: RawRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item: RawRow = {};
      headers.forEach((header, index) => {
        const cell = row.getCell(index + 1);
        item[header] = typeof cell.value === "number" ? cell.value : cell.text;
      });
      if (Object.values(item).some((value) => value !== "" && value != null))
        rows.push(item);
    });
    return { headers, rows };
  }

  function parseTsv(buffer: Buffer): { headers: string[]; rows: RawRow[] } {
    const matrix = parse(buffer, {
      delimiter: "\t",
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];
    if (!matrix.length) return { headers: [], rows: [] };
    const headers = matrix[0].map((header, index) => {
      const clean = String(header ?? "").trim();
      if (clean) return clean;
      if (index === matrix[0].length - 2) return "mz_fragments";
      if (index === matrix[0].length - 1) return "rt_vn";
      return `unnamed_${index + 1}`;
    });
    const rows = matrix
      .slice(1)
      .filter((row) => row.some((value) => String(value ?? "").trim()))
      .map((row) =>
        Object.fromEntries(
          headers.map((header, index) => [header, row[index] ?? ""]),
        ),
      );
    return { headers, rows };
  }

  const mappingSchema = z.object({
    compoundName: z.string(),
    adduct: z.string(),
    precursorMz: z.string().min(1),
    formula: z.string(),
    reportedPpm: z.string(),
    fragments: z.string(),
    excelCompoundName: z.string().min(1),
    excelRt: z.string().min(1),
  });

  app.get("/api/health", (_request, response) =>
    response.json({
      ok: true,
      service: "gnps2-api",
      authConfigured: !!(db && config.secret),
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!db || !config.secret)
      return next(
        new ApiError(
          503,
          "Cần cấu hình PostgreSQL và SESSION_SECRET. Xem README.",
          "AUTH_UNAVAILABLE",
        ),
      );
    next();
  });
  if (db && config.secret) {
    app.use(
      "/api",
      session({
        name: "gnps.sid",
        secret: config.secret,
        store: new PostgresSessionStore(db),
        resave: false,
        saveUninitialized: false,
        rolling: false,
        cookie: {
          httpOnly: true,
          secure: config.production,
          sameSite: "lax",
          maxAge: 86400000,
          path: "/",
        },
      }),
    );
    app.use(
      "/api",
      route(async (req, _res, next) => {
        if (req.session.userId) {
          const now = Date.now();
          if (
            !req.session.issuedAt ||
            now - req.session.issuedAt > 7 * 86400000 ||
            now - (req.session.lastActive ?? 0) > 86400000
          ) {
            await new Promise<void>((resolve, reject) =>
              req.session.destroy((e) => (e ? reject(e) : resolve())),
            );
            throw new ApiError(
              401,
              "Phiên đăng nhập hết hạn.",
              "UNAUTHENTICATED",
            );
          }
          const version = (
            await db.query("SELECT auth_version FROM users WHERE id=$1", [
              req.session.userId,
            ])
          ).rows[0]?.auth_version;
          if (version === undefined || version !== req.session.authVersion) {
            await new Promise<void>((resolve, reject) =>
              req.session.destroy((e) => (e ? reject(e) : resolve())),
            );
            throw new ApiError(
              401,
              "Phiên đăng nhập đã được thu hồi.",
              "UNAUTHENTICATED",
            );
          }
          if (now - (req.session.lastActive ?? 0) > 60000) {
            req.session.lastActive = now;
            req.session.cookie.maxAge = Math.min(
              86400000,
              req.session.issuedAt + 7 * 86400000 - now,
            );
          }
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
          const origin = req.headers.origin;
          if (
            origin &&
            !frontendOrigins.includes(origin) &&
            origin !== config.origin
          )
            throw new ApiError(403, "Origin không được phép.");
          if (!validCsrf(req.session.csrf, req.headers["x-csrf-token"]))
            throw new ApiError(
              403,
              "Phiên bảo vệ đã hết hạn. Hãy tải lại trang.",
              "CSRF_INVALID",
            );
        }
        next();
      }),
    );
    app.use("/api/auth", authRouter(db, config));
  }
  app.use(
    "/api",
    route((req, _res, next) => {
      owner(req);
      next();
    }),
  );
  let lastCleanup = 0;
  app.use("/api", (_req, _res, next) => {
    if (media && Date.now() - lastCleanup > 300000) {
      lastCleanup = Date.now();
      void media.cleanup().catch(() => {});
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { message: "Quá nhiều yêu cầu. Hãy thử lại sau." },
    }),
  );
  let active = 0;
  app.use(
    [
      "/api/analyze",
      "/api/gnps-task/import",
      "/api/structures/gnps2",
      "/api/reports",
    ],
    (req, res, next) => {
      if (req.method === "GET" || req.method === "DELETE") return next();
      if (active >= config.concurrency)
        return next(
          new ApiError(429, "Máy chủ đang bận. Hãy thử lại.", "SERVER_BUSY"),
        );
      active++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          active--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
  );
  const idSchema = z.string().uuid();
  const titleSchema = z.string().trim().min(1).max(160);
  const operationKey = (req: express.Request) =>
    z
      .string()
      .min(1)
      .max(100)
      .parse(req.headers["idempotency-key"] ?? randomUUID());
  app.get(
    "/api/reports",
    route(async (req, res) => {
      const user = owner(req),
        search = z
          .string()
          .max(160)
          .parse(req.query.search ?? "");
      const cursor = req.query.cursor
        ? z
            .object({ date: z.string().datetime(), id: idSchema })
            .parse(
              JSON.parse(
                Buffer.from(String(req.query.cursor), "base64url").toString(),
              ),
            )
        : null;
      const result = await db!.query(
        "SELECT id,title,revision,row_count,media_status,updated_at FROM reports WHERE owner_id=$1 AND title ILIKE $2 AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT 21",
        [
          user,
          `%${search.replace(/[\\%_]/g, "\\$&")}%`,
          cursor?.date ?? null,
          cursor?.id ?? null,
        ],
      );
      const items = result.rows.slice(0, 20),
        last = items.at(-1);
      res.json({
        items,
        nextCursor:
          result.rows.length > 20 && last
            ? Buffer.from(
                JSON.stringify({
                  date: new Date(last.updated_at).toISOString(),
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      });
    }),
  );
  app.post(
    "/api/reports",
    route(async (req, res) => {
      const body = z
        .object({ title: titleSchema, result: z.unknown() })
        .parse(req.body);
      res
        .status(201)
        .json(
          await reports!.create(
            owner(req),
            body.title,
            body.result,
            operationKey(req),
          ),
        );
    }),
  );
  app.get(
    "/api/reports/:id",
    route(async (req, res) =>
      res.json(await reports!.get(owner(req), idSchema.parse(req.params.id))),
    ),
  );
  app.patch(
    "/api/reports/:id",
    route(async (req, res) => {
      const b = z
        .object({
          title: titleSchema,
          result: z.unknown(),
          revision: z.number().int().positive(),
        })
        .parse(req.body);
      res.json(
        await reports!.update(
          owner(req),
          idSchema.parse(req.params.id),
          b.title,
          b.result,
          b.revision,
        ),
      );
    }),
  );
  app.delete(
    "/api/reports/:id",
    route(async (req, res) => {
      await reports!.remove(owner(req), idSchema.parse(req.params.id));
      res.sendStatus(204);
      void media!.cleanup().catch(() => {});
    }),
  );
  app.get(
    "/api/reports/:id/assets",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const report = await reports!.metadata(owner(req), id);
      const assets = await media!.list(owner(req), id);
      res.json({
        errors: report.media_errors,
        items: assets.map((a) => ({
          id: a.id,
          name: a.original_name,
          kind: a.kind,
          bytes: Number(a.bytes),
          state: a.state,
          rowId: a.row_id,
          revision: a.report_revision,
        })),
      });
    }),
  );
  app.get(
    "/api/reports/:id/assets/:assetId/download",
    route(async (req, res) => {
      const { asset, bytes } = await media!.download(
        owner(req),
        idSchema.parse(req.params.id),
        idSchema.parse(req.params.assetId),
      );
      res.set({
        "Content-Type": asset.mime,
        "Content-Disposition": contentDisposition(
          safeName(asset.original_name),
        ),
      });
      res.send(bytes);
    }),
  );
  app.get(
    "/api/reports/:id/assets/:assetId/preview",
    route(async (req, res) => {
      const { asset, bytes } = await media!.download(
        owner(req),
        idSchema.parse(req.params.id),
        idSchema.parse(req.params.assetId),
      );
      if (asset.kind === "source_tsv")
        res.json(previewTsv(bytes, asset.original_name));
      else if (asset.kind === "source_xlsx")
        res.json(
          await previewXlsx(
            bytes,
            asset.original_name,
            String(req.query.sheetName ?? ""),
          ),
        );
      else throw new ApiError(400, "Chỉ xem trước TSV/XLSX.");
    }),
  );
  app.post(
    "/api/reports/:id/assets/:assetId/retry",
    upload.single("file"),
    route(async (req, res) => {
      const user = owner(req),
        id = idSchema.parse(req.params.id),
        a = await media!.get(user, id, idSchema.parse(req.params.assetId));
      if (!req.file) throw new ApiError(400, "Cần chọn lại file để thử lưu.");
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(req.file.buffer).digest("hex") !== a.hash)
        throw new ApiError(400, "File được chọn không khớp file gốc.");
      const warning = await reports!.persistMedia(
        user,
        id,
        [],
        [
          {
            name: a.original_name,
            kind: a.kind!,
            rowId: a.row_id ?? undefined,
            bytes: req.file.buffer,
            mime: a.mime,
          },
        ],
      );
      res.json({ saveWarning: warning });
    }),
  );
  // Attach sources that previously failed before a cloud asset could be reserved (e.g. quota).
  app.post(
    "/api/reports/:id/assets",
    upload.single("file"),
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id),
        user = owner(req),
        r = await reports!.metadata(user, id);
      if (!req.file) throw new ApiError(400, "Cần chọn file.");
      const kind = z
          .enum([
            "source_tsv",
            "source_xlsx",
            "gnps_matches",
            "gnps_graphml",
            "gnps_mgf",
            "structure",
          ])
          .parse(req.body.kind),
        rowId = req.body.rowId
          ? z.string().max(100).parse(req.body.rowId)
          : undefined;
      const failure = r.media_errors.find(
        (f) =>
          f.kind === kind &&
          (rowId ? f.rowId === rowId : f.name === req.file!.originalname),
      );
      const original = kind === "source_tsv" || kind === "source_xlsx";
      const existing = await media!.list(user, id);
      if (
        !failure &&
        !(
          original &&
          r.data.source === "files" &&
          !existing.some((a) => a.kind === kind)
        )
      )
        throw new ApiError(400, "File này không thuộc danh sách cần bổ sung.");
      if (failure?.hash) {
        const { createHash } = await import("node:crypto");
        if (
          createHash("sha256").update(req.file.buffer).digest("hex") !==
          failure.hash
        )
          throw new ApiError(400, "File được chọn không khớp file gốc.");
      }
      const mime =
        kind === "source_tsv"
          ? "text/tab-separated-values"
          : kind === "source_xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : req.file.mimetype;
      res.json({
        saveWarning: await reports!.persistMedia(
          user,
          id,
          [],
          [
            {
              name: req.file.originalname,
              kind,
              rowId,
              bytes: req.file.buffer,
              mime,
            },
          ],
        ),
      });
    }),
  );
  const prepareExport: express.RequestHandler = route(
    async (req, res, next) => {
      const id = idSchema.parse(req.params.id),
        body = z
          .object({ revision: z.number().int().positive() })
          .parse(req.body),
        report = await reports!.get(owner(req), id, true);
      if (report.revision !== body.revision)
        throw new ApiError(
          409,
          "Báo cáo đã thay đổi. Tải lại trước khi xuất.",
          "REVISION_CONFLICT",
        );
      if (report.mediaErrors.some((f) => f.kind === "structure"))
        throw new ApiError(
          409,
          "Cần lưu đủ ảnh cấu trúc trước khi xuất.",
          "MEDIA_INCOMPLETE",
        );
      req.body = {
        rows: report.rows,
        title: report.title,
        fileName: report.title,
      };
      res.locals.exportReport = { id, revision: report.revision };
      next();
    },
  );
  async function archiveExport(
    req: express.Request,
    res: express.Response,
    bytes: Buffer,
    extension: "docx" | "xlsx",
    name: string,
  ) {
    try {
      await media!.attach(
        owner(req),
        res.locals.exportReport.id,
        {
          name: `${name}.${extension}`,
          kind: `export_${extension}`,
          bytes,
          mime:
            extension === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        res.locals.exportReport.revision,
      );
      await media!.trimExports(res.locals.exportReport.id);
      res.setHeader("X-Archive-Status", "saved");
    } catch {
      res.setHeader("X-Archive-Status", "failed");
    }
  }

  app.post(
    "/api/files/preview",
    upload.single("file"),
    async (request, response, next) => {
      try {
        const file = request.file;
        if (!file)
          return response
            .status(400)
            .json({ message: "Hãy chọn file cần xem." });
        await validateFile(
          {
            name: file.originalname,
            kind: file.originalname.toLowerCase().endsWith(".xlsx")
              ? "source_xlsx"
              : "source_tsv",
            bytes: file.buffer,
            mime: file.mimetype,
          },
          config,
        );
        const name = file.originalname.toLowerCase();
        if (name.endsWith(".tsv"))
          return response.json(previewTsv(file.buffer, file.originalname));
        if (name.endsWith(".xlsx"))
          return response.json(
            await previewXlsx(
              file.buffer,
              file.originalname,
              String(request.body.sheetName ?? ""),
            ),
          );
        return response
          .status(400)
          .json({ message: "Trình xem chỉ hỗ trợ file .tsv và .xlsx." });
      } catch (error) {
        next(error);
      }
    },
  );

  const wantsProgressStream = (req: express.Request) =>
    req.query.progress === "stream";
  const startProgressStream = (res: express.Response) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const keepAlive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
    }, 15_000);
    keepAlive.unref();
    res.once("close", () => clearInterval(keepAlive));
    res.once("finish", () => clearInterval(keepAlive));
  };
  const writeStreamEvent = (
    res: express.Response,
    name: "progress" | "result" | "error",
    data: PipelineProgress | unknown,
  ) => {
    if (!res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const existingOperation: express.RequestHandler = route(
    async (req, res, next) => {
      const key = operationKey(req);
      res.locals.operationKey = key;
      const old = (
        await db!.query(
          "SELECT id FROM reports WHERE owner_id=$1 AND idempotency_key=$2",
          [owner(req), key],
        )
      ).rows[0];
      if (old) {
        const saved = await reports!.get(owner(req), old.id);
        if (!wantsProgressStream(req)) return res.json(saved);
        startProgressStream(res);
        writeStreamEvent(res, "progress", {
          stage: "complete", step: 6, totalSteps: 6, percent: 100,
          title: "Báo cáo đã được lưu trước đó",
          message: "Đang mở dữ liệu đã lưu; không cần tải lại từ GNPS2.",
          outcome: "success",
        } satisfies PipelineProgress);
        writeStreamEvent(res, "result", saved);
        return res.end();
      }
      next();
    },
  );
  async function saveAnalysis(
    req: express.Request,
    res: express.Response,
    payload: unknown,
    title: string,
    files: MediaInput[],
    sourceUrl?: string,
    progress?: ProgressReporter,
  ) {
    try {
      const saved = await reports!.create(
        owner(req),
        title,
        payload,
        res.locals.operationKey,
        sourceUrl,
        files,
        progress,
      );
      const transient = (payload as { rows: MatchRow[] }).rows;
      return {
        ...saved,
        rows: saved.rows.map((row) => ({
          ...row,
          structureData:
            row.structureData ??
            transient.find((r) => r.id === row.id)?.structureData,
        })),
      };
    } catch (error) {
      progress?.({
        stage: "database", step: 5, totalSteps: 6, percent: 75,
        title: "Chưa lưu được vào database",
        message: "Dữ liệu đã đọc từ GNPS2 nhưng giao dịch lưu báo cáo thất bại.",
        detail: error instanceof ApiError ? error.message : undefined,
        outcome: "partial",
      });
      return {
        ...(payload as object),
        saveWarning:
          error instanceof ApiError
            ? error.message
            : "Phân tích thành công nhưng chưa lưu vào database. Hãy thử lưu lại.",
      };
    }
  }
  app.post(
    "/api/gnps-task/import",
    existingOperation,
    async (request, response, next) => {
      const input = z
        .object({ url: z.string().trim().min(1).max(2_000) })
        .safeParse(request.body);
      if (!input.success)
        return response
          .status(400)
          .json({ message: "Hãy nhập link GNPS2 Task hợp lệ." });
      const stream = wantsProgressStream(request);
      if (stream) startProgressStream(response);
      const progress: ProgressReporter | undefined = stream
        ? (event) => writeStreamEvent(response, "progress", event)
        : undefined;
      try {
        const imported = await importGnpsTask(input.data.url, progress);
        const emptyMapping: ColumnMapping = {
          compoundName: "Compound_Name",
          adduct: "Adduct",
          precursorMz: "SpecMZ",
          formula: "molecular_formula",
          reportedPpm: "MZErrorPPM",
          fragments: "specs_ms.mgf",
          excelCompoundName: "library_compound_name",
          excelRt: "rt_min",
        };
        const payload = {
          title: imported.metadata.title,
          task: imported.task,
          source: "gnps-task",
          rows: imported.rows,
          mapping: emptyMapping,
          tsvHeaders: imported.libraryHeaders,
          excelHeaders: [
            "id",
            "mz",
            "rt",
            "rt_min",
            "charge",
            "library_compound_name",
            "library_SMILES",
            "library_InChI",
          ],
          sheets: [],
          summary: {
            tsvRows: imported.rows.length,
            dataRows: imported.graphNodes,
            matched: imported.graphMatched,
            unmatched: imported.rows.filter((row) => row.status === "unmatched")
              .length,
            invalidTsv: 0,
            invalidData: 0,
            rtFallback: imported.rtFallback,
            structures: imported.structures,
            fragments: imported.fragments,
          },
          parameters: { mzMode: "ppm", mzTolerance: 0, rtTolerance: 0 },
        };
        const saved = await saveAnalysis(
          request,
          response,
          payload,
          imported.metadata.title,
          imported.sourceFiles,
          input.data.url,
          progress,
        );
        if (stream) {
          writeStreamEvent(response, "progress", {
            stage: "complete", step: 6, totalSteps: 6, percent: 100,
            title: saved.saveWarning ? "Đã nhập dữ liệu, cần kiểm tra lưu trữ" : "Đồng bộ dữ liệu hoàn tất",
            message: saved.saveWarning
              ? String(saved.saveWarning)
              : `Đã nhập ${imported.rows.length} dòng, lưu báo cáo và xử lý ${imported.structures} ảnh cấu trúc cùng ${imported.sourceFiles.length} file nguồn.`,
            current: imported.rows.length, total: imported.rows.length,
            succeeded: imported.rows.length,
            outcome: saved.saveWarning ? "partial" : "success",
          } satisfies PipelineProgress);
          writeStreamEvent(response, "result", saved);
          return response.end();
        }
        return response.json(saved);
      } catch (error) {
        if (stream && response.headersSent) {
          const apiError = error instanceof ApiError ? error : undefined;
          writeStreamEvent(response, "error", {
            message: apiError?.message ?? "Không thể hoàn tất đồng bộ dữ liệu GNPS2.",
            code: apiError?.code,
          });
          return response.end();
        }
        next(error);
      }
    },
  );

  app.post(
    "/api/analyze",
    existingOperation,
    upload.fields([
      { name: "tsv", maxCount: 1 },
      { name: "xlsx", maxCount: 1 },
    ]),
    async (request, response, next) => {
      try {
        const files = request.files as
          Record<string, Express.Multer.File[]> | undefined;
        const tsv = files?.tsv?.[0];
        const xlsx = files?.xlsx?.[0];
        if (!tsv || !xlsx)
          return response
            .status(400)
            .json({ message: "Cần chọn đủ file TSV và XLSX." });
        const sourceFiles: MediaInput[] = [
          {
            name: tsv.originalname,
            kind: "source_tsv",
            bytes: tsv.buffer,
            mime: "text/tab-separated-values",
          },
          {
            name: xlsx.originalname,
            kind: "source_xlsx",
            bytes: xlsx.buffer,
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ];
        for (const file of sourceFiles) await validateFile(file, config);
        if (
          !tsv.originalname.toLowerCase().endsWith(".tsv") ||
          !xlsx.originalname.toLowerCase().endsWith(".xlsx")
        ) {
          return response
            .status(400)
            .json({
              message: "Định dạng không hợp lệ. Chỉ chấp nhận .tsv và .xlsx.",
            });
        }

        const parsedTsv = parseTsv(tsv.buffer);
        const tsvRows = parsedTsv.rows;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(xlsx.buffer as unknown as ExcelJS.Buffer);
        const sheetName = String(request.body.sheetName ?? "");
        const worksheet =
          workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];
        if (!worksheet)
          return response
            .status(400)
            .json({ message: "Workbook không có sheet dữ liệu." });
        const excel = rowsFromWorksheet(worksheet);
        const tsvHeaders = parsedTsv.headers;

        let mapping: ColumnMapping;
        if (request.body.mapping)
          mapping = mappingSchema.parse(
            JSON.parse(String(request.body.mapping)),
          );
        else
          mapping = {
            compoundName: guessColumn(tsvHeaders, "compoundName"),
            adduct: guessColumn(tsvHeaders, "adduct"),
            precursorMz: guessColumn(tsvHeaders, "precursorMz"),
            formula: guessColumn(tsvHeaders, "formula"),
            reportedPpm: guessColumn(tsvHeaders, "reportedPpm"),
            fragments: guessColumn(tsvHeaders, "fragments"),
            excelCompoundName: guessColumn(excel.headers, "excelCompoundName"),
            excelRt: guessColumn(excel.headers, "excelRt"),
          };

        const missing = [
          "compoundName",
          "precursorMz",
          "excelCompoundName",
          "excelRt",
        ].filter((key) => !mapping[key as keyof ColumnMapping]);
        if (missing.length)
          return response.status(422).json({
            code: "COLUMN_MAPPING_REQUIRED",
            message: "Không thể tự nhận diện đủ cột bắt buộc.",
            missing,
            tsvHeaders,
            excelHeaders: excel.headers,
            sheets: workbook.worksheets.map((sheet) => sheet.name),
            mapping,
          });

        const mzMode = request.body.mzMode === "da" ? "da" : "ppm";
        const mzTolerance = Number(request.body.mzTolerance ?? 10);
        const rtTolerance = Number(request.body.rtTolerance ?? 0.5);
        if (
          !Number.isFinite(mzTolerance) ||
          !Number.isFinite(rtTolerance) ||
          !(mzTolerance > 0) ||
          !(rtTolerance > 0)
        )
          return response
            .status(400)
            .json({ message: "Tolerance phải là số hữu hạn lớn hơn 0." });
        const result = matchRows(tsvRows, excel.rows, mapping, {
          mzMode,
          mzTolerance,
          rtTolerance,
        });
        const { rows, ...diagnostics } = result;
        const payload = {
          source: "files",
          rows: result.rows,
          mapping,
          tsvHeaders,
          excelHeaders: excel.headers,
          sheets: workbook.worksheets.map((sheet) => sheet.name),
          summary: {
            tsvRows: tsvRows.length,
            dataRows: excel.rows.length,
            ...diagnostics,
          },
          parameters: { mzMode, mzTolerance, rtTolerance },
        };
        const title = titleSchema.parse(
          request.body.title ?? tsv.originalname.replace(/\.tsv$/i, ""),
        );
        return response.json(
          await saveAnalysis(request, response, payload, title, sourceFiles),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  const exportSchema = z.object({
    rows: z.array(z.record(z.unknown())),
    title: z.string().trim().min(1).max(160).optional(),
    fileName: z.string().optional(),
  });

  function formatNumber(value: unknown, digits = 3) {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("vi-VN", { maximumFractionDigits: digits })
      : "";
  }

  function molecularFormulaText(value: unknown) {
    return String(value ?? "").trim();
  }

  /** Build native Word subscript runs; digits keep the same font size. */
  function molecularFormulaRuns(value: unknown, size = 20) {
    return molecularFormulaText(value)
      .split(/(\d+)/)
      .filter(Boolean)
      .map((part) =>
        /^\d+$/.test(part)
          ? new TextRun({ text: part, size, subScript: true })
          : new TextRun({ text: part, size }),
      );
  }

  function reportRows(input: Record<string, unknown>[]) {
    // Carbone keeps the template's sample picture when an image tag receives an
    // empty string. A transparent 1x1 PNG makes the Word cell visually blank.
    const blankStructure =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcO7WQAAAABJRU5ErkJggg==";
    return input
      .filter((row) => row.selected !== false)
      .map((row, index) => ({
        stt: index + 1,
        rt: String(
          row.rtDisplay ?? formatNumber(row.rtTsv ?? row.rtData, 3),
        ).replace(".", ","),
        ten_hoat_chat: String(row.compoundName ?? ""),
        ion: String(row.adduct ?? ""),
        mz_precursor: formatNumber(row.mzTsv, 5),
        mz_fragments: String(row.fragments ?? ""),
        cong_thuc: molecularFormulaText(row.molecularFormula),
        sai_so_ppm: formatNumber(row.reportedMzErrorPpm ?? row.deltaPpm, 5),
        cau_truc: String(row.structureData || blankStructure),
      }));
  }

  async function fallbackDocx(
    rows: ReturnType<typeof reportRows>,
    title: string,
  ) {
    const headers = [
      "STT",
      "RT",
      "Tên hoạt chất",
      "Ion",
      "m/z precursor",
      "m/z fragments",
      "Công thức",
      "Sai số ppm",
    ];
    const borders = { style: BorderStyle.SINGLE, size: 1, color: "9CB6C5" };
    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: headers.map(
          (value) =>
            new TableCell({
              shading: { fill: "D9EEF2" },
              borders: {
                top: borders,
                bottom: borders,
                left: borders,
                right: borders,
              },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: value, bold: true, color: "083344" }),
                  ],
                }),
              ],
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: [
              row.stt,
              row.rt,
              row.ten_hoat_chat,
              row.ion,
              row.mz_precursor,
              row.mz_fragments,
              row.cong_thuc,
              row.sai_so_ppm,
            ].map(
              (value, columnIndex) =>
                new TableCell({
                  borders: {
                    top: borders,
                    bottom: borders,
                    left: borders,
                    right: borders,
                  },
                  children: [
                    new Paragraph({
                      children:
                        columnIndex === 6
                          ? molecularFormulaRuns(value)
                          : [new TextRun({ text: String(value), size: 20 })],
                    }),
                  ],
                }),
            ),
          }),
      ),
    ];
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: title, bold: true, color: "075985" }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `Ngày xuất: ${new Date().toLocaleString("vi-VN")}`,
                  italics: true,
                }),
              ],
            }),
            new Paragraph(""),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: tableRows,
            }),
          ],
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  function escapeXml(value: string) {
    return value.replace(
      /[<>&'\"]/g,
      (character) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          "'": "&apos;",
          '"': "&quot;",
        })[character] ?? character,
    );
  }

  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Carbone fills template placeholders as plain text. Convert those formula
   * runs in the generated OOXML so template exports use native Word subscripts.
   */
  async function injectFormulaSubscripts(
    docx: Buffer,
    rows: ReturnType<typeof reportRows>,
  ) {
    const zip = await JSZip.loadAsync(docx);
    const documentPart = zip.file("word/document.xml");
    if (!documentPart) return docx;
    let documentXml = await documentPart.async("string");

    for (const row of rows) {
      const formula = molecularFormulaText(row.cong_thuc);
      if (!formula || !/\d/.test(formula)) continue;
      const escapedFormula = escapeXml(formula);
      const formulaPattern = escapeRegExp(escapedFormula);
      const runPattern = new RegExp(
        `(<w:r(?:\\s[^>]*)?>\\s*)(<w:rPr>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:rPr>\\s*)?(<w:t(?:\\s[^>]*)?>)${formulaPattern}(</w:t>)(</w:r>)`,
      );
      documentXml = documentXml.replace(
        runPattern,
        (
          _match,
          runOpen: string,
          runProperties: string | undefined,
          textOpen: string,
          _textClose: string,
          runClose: string,
        ) => {
          const baseProperties = runProperties ?? "";
          return formula
            .split(/(\d+)/)
            .filter(Boolean)
            .map((part) => {
              let properties = baseProperties;
              if (/^\d+$/.test(part)) {
                properties = properties
                  ? properties.replace(
                      "</w:rPr>",
                      '<w:vertAlign w:val="subscript"/></w:rPr>',
                    )
                  : '<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>';
              }
              return `${runOpen}${properties}${textOpen}${escapeXml(part)}</w:t>${runClose}`;
            })
            .join("");
        },
      );
    }

    zip.file("word/document.xml", documentXml);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  async function injectStructureImages(
    docx: Buffer,
    rows: ReturnType<typeof reportRows>,
  ) {
    const zip = await JSZip.loadAsync(docx);
    const documentPart = zip.file("word/document.xml");
    const relationsPart = zip.file("word/_rels/document.xml.rels");
    if (!documentPart || !relationsPart) return docx;
    let documentXml = await documentPart.async("string");
    let relationsXml = await relationsPart.async("string");
    let rowIndex = 0;
    documentXml = documentXml.replace(
      /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g,
      (tableRow) => {
        if (!tableRow.includes("<w:drawing>") || rowIndex >= rows.length)
          return tableRow;
        const dataUri = rows[rowIndex].cau_truc;
        const match = dataUri.match(
          /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i,
        );
        const currentIndex = rowIndex++;
        if (!match) return tableRow;
        const extension =
          match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
        const relationId = `rIdGnpsStructure${currentIndex + 1}`;
        const mediaName = `gnps-structure-${currentIndex + 1}.${extension}`;
        zip.file(`word/media/${mediaName}`, Buffer.from(match[2], "base64"));
        relationsXml = relationsXml.replace(
          "</Relationships>",
          `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`,
        );
        return tableRow.replace(
          /(<a:blip\b[^>]*?r:embed=")[^"]+("[^>]*>)/,
          `$1${relationId}$2`,
        );
      },
    );
    zip.file("word/document.xml", documentXml);
    zip.file("word/_rels/document.xml.rels", relationsXml);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  app.post(
    "/api/reports/:id/export/docx",
    prepareExport,
    async (request, response, next) => {
      try {
        const body = exportSchema.parse(request.body);
        const rows = reportRows(body.rows);
        const title = body.title ?? "BÁO CÁO KẾT QUẢ PHÂN TÍCH";
        const template = path.join(root, "templates", "report-template.docx");
        let output: Buffer;
        if (existsSync(template)) {
          const carbone = require("carbone") as {
            render: (
              template: string,
              data: unknown,
              callback: (error: Error | null, result: Buffer) => void,
            ) => void;
          };
          output = await new Promise((resolve, reject) =>
            carbone.render(template, { title, rows }, (error, result) =>
              error ? reject(error) : resolve(result),
            ),
          );
          output = await injectStructureImages(output, rows);
        } else output = await fallbackDocx(rows, title);
        output = await injectFormulaSubscripts(output, rows);
        const name = safeName(body.fileName ?? title);
        await archiveExport(request, response, output, "docx", name);
        response.set({
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": contentDisposition(`${name}.docx`),
        });
        response.send(output);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/structures/gnps2", async (request, response) => {
    const input = z
      .object({
        url: z.string().url(),
        rows: z
          .array(z.object({ id: z.string(), compoundName: z.string().min(1) }))
          .max(200),
      })
      .safeParse(request.body);
    if (!input.success)
      return response
        .status(400)
        .json({ message: "URL GNPS2 hoặc danh sách hợp chất không hợp lệ." });
    let resultUrl: URL;
    try {
      resultUrl = new URL(input.data.url);
    } catch {
      return response.status(400).json({ message: "URL GNPS2 không hợp lệ." });
    }
    if (
      !["gnps2.org", "www.gnps2.org"].includes(resultUrl.hostname.toLowerCase())
    )
      return response
        .status(400)
        .json({ message: "Chỉ chấp nhận URL kết quả từ gnps2.org." });
    const task = resultUrl.searchParams.get("task") ?? "";
    if (!/^[a-f0-9]{32}$/i.test(task))
      return response
        .status(400)
        .json({ message: "Không tìm thấy Task ID GNPS2 hợp lệ trong URL." });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let libraryRows: Array<Record<string, unknown>>;
    try {
      const gnpsResponse = await fetch(
        `https://gnps2.org/result?json=&task=${task}&viewname=librarymatches`,
        { signal: controller.signal },
      );
      if (!gnpsResponse.ok)
        throw new Error(`GNPS2 HTTP ${gnpsResponse.status}`);
      libraryRows = (await gnpsResponse.json()) as Array<
        Record<string, unknown>
      >;
      if (!Array.isArray(libraryRows))
        throw new Error("GNPS2 response is not an array");
    } catch (error) {
      clearTimeout(timeout);
      return response
        .status(502)
        .json({
          message: `Không thể đọc Library Matches từ GNPS2: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
    clearTimeout(timeout);
    const normalize = (value: unknown) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[_/\\()[\]{}+,:;"']/g, " ")
        .replace(/[^a-z0-9 -]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const resolved: Array<{
      id: string;
      status: "found" | "not_found" | "error";
      structureData?: string;
      cid?: number;
    }> = [];
    for (const row of input.data.rows) {
      const wanted = normalize(row.compoundName);
      const candidates = libraryRows
        .filter((item) => {
          const name = normalize(item.Compound_Name);
          return (
            name === wanted ||
            (wanted.length >= 4 && name.includes(wanted)) ||
            (name.length >= 4 && wanted.includes(name))
          );
        })
        .sort((a, b) => {
          const nameA = normalize(a.Compound_Name);
          const nameB = normalize(b.Compound_Name);
          return (
            Number(nameA !== wanted) - Number(nameB !== wanted) ||
            nameA.length - nameB.length
          );
        });
      const match = candidates[0];
      const inchi = String(match?.INCHI ?? "")
        .replace(/^"|"$/g, "")
        .trim();
      const smiles = String(match?.Smiles ?? "").trim();
      const valid = (value: string) =>
        value && !["null", "nan", "n/a"].includes(value.toLowerCase());
      const validInchi = valid(inchi);
      const validSmiles = valid(smiles);
      if (!match || (!validInchi && !validSmiles)) {
        resolved.push({ id: row.id, status: "not_found" });
        continue;
      }
      try {
        const imageController = new AbortController();
        const imageTimer = setTimeout(() => imageController.abort(), 10_000);
        const query = validInchi
          ? `inchi=${encodeURIComponent(inchi)}`
          : `smiles=${encodeURIComponent(smiles)}`;
        const imageResponse = await fetch(
          `https://structure.gnps2.org/structureimg?${query}`,
          { signal: imageController.signal },
        );
        clearTimeout(imageTimer);
        if (!imageResponse.ok) {
          resolved.push({ id: row.id, status: "not_found" });
          continue;
        }
        const contentType = imageResponse.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          resolved.push({ id: row.id, status: "not_found" });
          continue;
        }
        const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString(
          "base64",
        );
        resolved.push({
          id: row.id,
          status: "found",
          structureData: `data:${contentType.split(";")[0]};base64,${base64}`,
        });
      } catch {
        resolved.push({ id: row.id, status: "error" });
      }
    }
    response.json({
      resolved,
      task,
      libraryMatches: libraryRows.length,
      found: resolved.filter((item) => item.status === "found").length,
    });
  });

  app.post(
    "/api/reports/:id/export/xlsx",
    prepareExport,
    async (request, response, next) => {
      try {
        const body = exportSchema.parse(request.body);
        const rows = reportRows(body.rows);
        const selectedRows = body.rows.filter((row) => row.selected !== false);
        const preferredMetadata = [
          "SpectrumID",
          "#Scan#",
          "SpectrumFile",
          "LibraryName",
          "MQScore",
          "TIC_Query",
          "RT_Query",
          "MZErrorPPM",
          "SharedPeaks",
          "MassDiff",
          "SpecMZ",
          "SpecCharge",
          "FileScanUniqueID",
          "NumberHits",
          "Compound_Name",
          "Ion_Source",
          "Instrument",
          "Compound_Source",
          "PI",
          "Data_Collector",
          "Adduct",
          "Precursor_MZ",
          "ExactMass",
          "Charge",
          "CAS_Number",
          "Pubmed_ID",
          "Smiles",
          "INCHI",
          "INCHI_AUX",
          "Library_Class",
          "IonMode",
          "Organism",
          "LibMZ",
          "UpdateWorkflowName",
          "LibraryQualityString",
          "tags",
          "molecular_formula",
          "InChIKey",
          "InChIKey-Planar",
          "superclass",
          "class",
          "subclass",
          "npclassifier_superclass",
          "npclassifier_class",
          "npclassifier_pathway",
          "library_usi",
        ];
        const presentKeys = new Set(
          selectedRows.flatMap((row) => {
            const metadata = row.sourceMetadata;
            return metadata &&
              typeof metadata === "object" &&
              !Array.isArray(metadata)
              ? Object.keys(metadata)
              : [];
          }),
        );
        const metadataKeys = [
          ...preferredMetadata.filter((key) => presentKeys.has(key)),
          ...[...presentKeys]
            .filter((key) => !preferredMetadata.includes(key))
            .sort((a, b) => a.localeCompare(b)),
        ];
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Report");
        const reportColumns = [
          ["STT", "stt", 8],
          ["RT", "rt", 12],
          ["Tên hoạt chất", "ten_hoat_chat", 32],
          ["Ion", "ion", 16],
          ["m/z precursor", "mz_precursor", 18],
          ["m/z fragments", "mz_fragments", 28],
          ["Công thức", "cong_thuc", 18],
          ["Sai số ppm", "sai_so_ppm", 16],
        ].map(([header, key, width]) => ({ header, key, width }));
        const metadataColumns = metadataKeys.map((header, index) => ({
          header,
          key: `metadata_${index}`,
          width: Math.min(45, Math.max(14, header.length + 3)),
        }));
        sheet.columns = [
          ...reportColumns,
          ...metadataColumns,
        ] as ExcelJS.Column[];
        rows.forEach((row, rowIndex) => {
          const metadata = selectedRows[rowIndex]?.sourceMetadata;
          const source =
            metadata && typeof metadata === "object" && !Array.isArray(metadata)
              ? (metadata as Record<string, unknown>)
              : {};
          sheet.addRow({
            ...row,
            ...Object.fromEntries(
              metadataKeys.map((key, index) => [
                `metadata_${index}`,
                source[key] ?? null,
              ]),
            ),
          });
        });
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF075985" },
        };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: {
            row: Math.max(1, rows.length + 1),
            column: Math.max(1, sheet.columnCount),
          },
        };
        const output = await workbook.xlsx.writeBuffer();
        const name = safeName(
          body.fileName ??
            body.title ??
            `GNPS2_Data_${new Date().toISOString().slice(0, 10)}`,
        );
        await archiveExport(
          request,
          response,
          Buffer.from(output),
          "xlsx",
          name,
        );
        response.set({
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": contentDisposition(`${name}.xlsx`),
        });
        response.send(Buffer.from(output));
      } catch (error) {
        next(error);
      }
    },
  );

  app.use("/api", (_req, _res, next) =>
    next(new ApiError(404, "API không tồn tại.")),
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (response.headersSent) return _next(error);
      const status =
        error instanceof ApiError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : error instanceof multer.MulterError
              ? 413
              : (error as { type?: string }).type === "entity.too.large"
                ? 413
                : (error as { status?: number }).status === 400
                  ? 400
                  : 503;
      const message =
        error instanceof ApiError
          ? error.message
          : status === 400
            ? "Dữ liệu gửi lên không hợp lệ."
            : status === 413
              ? "File hoặc dữ liệu vượt giới hạn."
              : "Dịch vụ tạm thời không sẵn sàng. Kiểm tra cấu hình và thử lại.";
      if (status >= 500)
        console.error(
          "[GNPS2_API]",
          error instanceof ApiError ? error.code : "SERVICE_UNAVAILABLE",
        );
      response
        .status(status)
        .json({
          message,
          code: error instanceof ApiError ? error.code : "REQUEST_FAILED",
        });
    },
  );

  if (existsSync(path.join(root, "dist"))) {
    const dist = path.join(root, "dist");
    app.use(express.static(dist));
    app.get("*", (_request, response) =>
      response.sendFile(path.join(dist, "index.html")),
    );
  }
  return { app, reports, media };
}
