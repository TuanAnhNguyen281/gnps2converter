import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../db/index.js";
import { ApiError, owner, route } from "../errors.js";
import {
  DEFAULT_PAGE,
  basicTemplate,
  blankTemplate,
  sanitizePage,
  sanitizeTemplate,
} from "../shared/report-template.js";

const MAX_TEMPLATES = 50;
const MAX_BYTES = 500_000;
const name = z.string().trim().min(1).max(160);

// Saved content is always the sanitized form, so exports and previews only
// ever see whitelisted nodes and field keys.
function clean(content: unknown) {
  let doc;
  try {
    doc = sanitizeTemplate(content);
  } catch (e) {
    throw new ApiError(400, (e as Error).message, "TEMPLATE_INVALID");
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_BYTES)
    throw new ApiError(413, "Mẫu vượt quá 500KB.", "TEMPLATE_TOO_LARGE");
  return doc;
}

export function templatesRouter(db: Database) {
  const router = Router();
  async function owned(id: string, user: string) {
    const t = (
      await db.query(
        "SELECT * FROM report_templates WHERE id=$1 AND owner_id=$2",
        [z.string().uuid().parse(id), user],
      )
    ).rows[0];
    if (!t) throw new ApiError(404, "Không tìm thấy mẫu Word.");
    return t;
  }
  async function create(
    user: string,
    values: { name: string; content: unknown; page: unknown },
  ) {
    const n = (
      await db.query(
        "SELECT count(*)::int AS n FROM report_templates WHERE owner_id=$1",
        [user],
      )
    ).rows[0].n;
    if (n >= MAX_TEMPLATES)
      throw new ApiError(
        429,
        `Tối đa ${MAX_TEMPLATES} mẫu Word mỗi tài khoản.`,
      );
    return (
      await db.query(
        "INSERT INTO report_templates(id,owner_id,name,content,page) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          randomUUID(),
          user,
          values.name,
          JSON.stringify(clean(values.content)),
          JSON.stringify(sanitizePage(values.page)),
        ],
      )
    ).rows[0];
  }
  router.get(
    "/report-templates",
    route(async (req, res) => {
      res.json(
        (
          await db.query(
            "SELECT id,name,page,created_at,updated_at FROM report_templates WHERE owner_id=$1 ORDER BY updated_at DESC",
            [owner(req)],
          )
        ).rows,
      );
    }),
  );
  router.get(
    "/report-templates/:id",
    route(async (req, res) => {
      res.json(await owned(req.params.id as string, owner(req)));
    }),
  );
  router.post(
    "/report-templates",
    route(async (req, res) => {
      const b = z
        .object({
          name,
          start: z.enum(["basic", "blank"]).default("basic"),
        })
        .strict()
        .parse(req.body);
      res.status(201).json(
        await create(owner(req), {
          name: b.name,
          content: b.start === "basic" ? basicTemplate() : blankTemplate(),
          page: DEFAULT_PAGE,
        }),
      );
    }),
  );
  router.post(
    "/report-templates/:id/duplicate",
    route(async (req, res) => {
      const user = owner(req),
        t = await owned(req.params.id as string, user);
      res
        .status(201)
        .json(
          await create(user, {
            name: `${t.name} (bản sao)`.slice(0, 160),
            content: t.content,
            page: t.page,
          }),
        );
    }),
  );
  router.patch(
    "/report-templates/:id",
    route(async (req, res) => {
      const user = owner(req),
        t = await owned(req.params.id as string, user),
        b = z
          .object({
            name: name.optional(),
            content: z.unknown().optional(),
            page: z.unknown().optional(),
          })
          .strict()
          .parse(req.body);
      res.json(
        (
          await db.query(
            "UPDATE report_templates SET name=$2,content=$3,page=$4,updated_at=now() WHERE id=$1 RETURNING *",
            [
              t.id,
              b.name ?? t.name,
              JSON.stringify(
                b.content === undefined ? t.content : clean(b.content),
              ),
              JSON.stringify(
                b.page === undefined ? t.page : sanitizePage(b.page),
              ),
            ],
          )
        ).rows[0],
      );
    }),
  );
  router.delete(
    "/report-templates/:id",
    route(async (req, res) => {
      const t = await owned(req.params.id as string, owner(req));
      await db.query("DELETE FROM report_templates WHERE id=$1", [t.id]);
      res.sendStatus(204);
    }),
  );
  return router;
}
