import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
export const users = pgTable("users", {
  id: uuid().primaryKey(),
  email: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  authVersion: integer("auth_version").notNull().default(0),
  cloudBytes: bigint("cloud_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const accounts = pgTable(
  "auth_accounts",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    subject: text().notNull(),
  },
  (t) => [
    uniqueIndex("account_subject").on(t.provider, t.subject),
    uniqueIndex("account_provider").on(t.userId, t.provider),
  ],
);
export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    data: jsonb().notNull(),
    sourceUrl: text("source_url"),
    revision: integer().notNull().default(1),
    rowCount: integer("row_count").notNull(),
    storageBytes: integer("storage_bytes").notNull(),
    idempotencyKey: text("idempotency_key"),
    mediaStatus: text("media_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    mediaErrors: jsonb("media_errors").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("report_operation").on(t.ownerId, t.idempotencyKey),
    index("report_history").on(t.ownerId, t.updatedAt, t.id),
  ],
);
export const assets = pgTable("media_assets", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  publicId: text("public_id").notNull().unique(),
  cloudAssetId: text("cloud_asset_id"),
  version: text(),
  resourceType: text("resource_type").notNull(),
  deliveryType: text("delivery_type").notNull().default("authenticated"),
  originalName: text("original_name").notNull(),
  mime: text().notNull(),
  bytes: bigint({ mode: "number" }).notNull(),
  hash: text().notNull(),
  state: text().notNull().default("pending"),
  attempts: integer().notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", {
    withTimezone: true,
  }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const reportAssets = pgTable("report_assets", {
  id: uuid().primaryKey(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  kind: text().notNull(),
  rowId: text("row_id"),
  reportRevision: integer("report_revision"),
});
export const reportRows = pgTable(
  "report_rows",
  {
    id: uuid().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    sourceRowId: text("source_row_id").notNull(),
    position: integer().notNull(),
    compoundName: text("compound_name").notNull(),
    status: text().notNull(),
    selected: boolean().notNull(),
    payload: jsonb().notNull(),
  },
  (t) => [
    uniqueIndex("row_source").on(t.reportId, t.sourceRowId),
    uniqueIndex("row_position").on(t.reportId, t.position),
  ],
);
