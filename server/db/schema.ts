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
  primaryKey,
  date,
  numeric,
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
export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    description: text().notNull().default(""),
    researchGoal: text("research_goal").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("projects_id_owner_id_key").on(t.id, t.ownerId)],
);
export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    projectId: uuid("project_id").references(() => projects.id),
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

// SQL migrations are authoritative for composite ownership FKs and state checks.
export const aiProviders = pgTable("ai_providers", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text().notNull(),
  baseUrl: text("base_url").notNull(),
  adapterType: text("adapter_type").notNull().default("openai-compatible"),
  secret: jsonb().notNull(),
  keyVersion: text("key_version").notNull().default("v1"),
  enabled: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiProviderModels = pgTable(
  "ai_provider_models",
  {
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    enabled: boolean().notNull().default(true),
    supportsTools: boolean("supports_tools").notNull().default(false),
    supportsStream: boolean("supports_stream").notNull().default(false),
    contextLimit: integer("context_limit").notNull().default(16000),
    maxOutput: integer("max_output").notNull().default(2000),
    inputPricePerMillion: numeric("input_price_per_million", {
      precision: 14,
      scale: 6,
    }),
    outputPricePerMillion: numeric("output_price_per_million", {
      precision: 14,
      scale: 6,
    }),
    currency: text("currency").notNull().default("USD"),
    pricingVersion: integer("pricing_version").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.modelId] })],
);
export const researchSessions = pgTable("research_sessions", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  title: text().notNull(),
  status: text().notNull().default("active"),
  activeReportId: uuid("active_report_id"),
  viewState: jsonb("view_state").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiSettings = pgTable(
  "ai_settings",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    scope: text().notNull(),
    scopeId: uuid("scope_id").notNull(),
    providerId: uuid("provider_id").notNull(),
    modelId: text("model_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.scope, t.scopeId] })],
);
export const aiConversations = pgTable("ai_conversations", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  projectId: uuid("project_id").notNull(),
  researchSessionId: uuid("research_session_id").notNull(),
  title: text().notNull().default("Hội thoại mới"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  summary: jsonb().notNull().default([]),
  summaryVersion: integer("summary_version").notNull().default(0),
  summaryUntilSeq: integer("summary_until_seq").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiContextSnapshots = pgTable("ai_context_snapshots", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  projectId: uuid("project_id").notNull(),
  payload: jsonb().notNull(),
  hash: text().notNull(),
  promptVersion: text("prompt_version").notNull().default("gnps-research-v1"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiRequests = pgTable("ai_requests", {
  id: uuid().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  clientRequestId: uuid("client_request_id").notNull(),
  retryOf: uuid("retry_of"),
  userMessage: text("user_message").notNull().default(""),
  requestFingerprint: text("request_fingerprint").notNull().default(""),
  state: text().notNull(),
  providerId: uuid("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  providerName: text("provider_name").notNull(),
  contextSnapshotId: uuid("context_snapshot_id").references(
    () => aiContextSnapshots.id,
  ),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
export const aiMessages = pgTable("ai_messages", {
  id: uuid().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  sequence: integer().notNull(),
  role: text().notNull(),
  content: text().notNull().default(""),
  requestId: uuid("request_id")
    .notNull()
    .references(() => aiRequests.id, { onDelete: "cascade" }),
  status: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiToolRuns = pgTable("ai_tool_runs", {
  id: uuid().primaryKey(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => aiRequests.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  arguments: jsonb().notNull(),
  result: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiUsage = pgTable("ai_usage", {
  requestId: uuid("request_id")
    .primaryKey()
    .references(() => aiRequests.id, { onDelete: "cascade" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  usageSource: text("usage_source").notNull().default("unknown"),
  reservedTokens: integer("reserved_tokens").notNull(),
  inputPricePerMillion: numeric("input_price_per_million", {
    precision: 14,
    scale: 6,
  }),
  outputPricePerMillion: numeric("output_price_per_million", {
    precision: 14,
    scale: 6,
  }),
  currency: text("currency"),
  pricingVersion: integer("pricing_version"),
  estimatedMaxCost: numeric("estimated_max_cost", { precision: 18, scale: 8 }),
  estimatedCost: numeric("estimated_cost", { precision: 18, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const aiDailyBudgets = pgTable(
  "ai_daily_budgets",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    day: date().notNull(),
    requests: integer().notNull().default(0),
    testRequests: integer("test_requests").notNull().default(0),
    reservedTokens: bigint("reserved_tokens", { mode: "number" })
      .notNull()
      .default(0),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.day] })],
);
