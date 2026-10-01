CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', research_goal text NOT NULL DEFAULT '', archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
ALTER TABLE reports ADD COLUMN project_id uuid;
ALTER TABLE reports ADD CONSTRAINT report_project_owner FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id);
ALTER TABLE reports ADD CONSTRAINT report_owner_unique UNIQUE(id,owner_id);
CREATE INDEX reports_project ON reports(owner_id,project_id,updated_at DESC);
CREATE TABLE ai_providers (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, base_url text NOT NULL,
 adapter_type text NOT NULL DEFAULT 'openai-compatible', secret jsonb NOT NULL, key_version text NOT NULL DEFAULT 'v1',
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
CREATE TABLE ai_provider_models (
 provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE, model_id text NOT NULL,
 display_name text NOT NULL, enabled boolean NOT NULL DEFAULT true, supports_tools boolean NOT NULL DEFAULT false,
 supports_stream boolean NOT NULL DEFAULT false, context_limit integer NOT NULL DEFAULT 16000 CHECK(context_limit BETWEEN 2000 AND 200000),
 max_output integer NOT NULL DEFAULT 2000 CHECK(max_output BETWEEN 128 AND 16000),
 verified_at timestamptz, discovered_at timestamptz, PRIMARY KEY(provider_id,model_id)
);
CREATE TABLE research_sessions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL,
 title text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 active_report_id uuid, view_state jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 last_active_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id,project_id),
 FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id),
 FOREIGN KEY(active_report_id,owner_id) REFERENCES reports(id,owner_id) ON DELETE SET NULL (active_report_id)
);
CREATE TABLE ai_settings (
 owner_id uuid NOT NULL REFERENCES users(id), scope text NOT NULL CHECK(scope IN ('account','project','session')),
 scope_id uuid NOT NULL, provider_id uuid NOT NULL, model_id text NOT NULL,
 PRIMARY KEY(owner_id,scope,scope_id), FOREIGN KEY(provider_id,owner_id) REFERENCES ai_providers(id,owner_id),
 FOREIGN KEY(provider_id,model_id) REFERENCES ai_provider_models(provider_id,model_id)
);
CREATE TABLE ai_conversations (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, project_id uuid NOT NULL, research_session_id uuid NOT NULL,
 title text NOT NULL DEFAULT 'Hội thoại mới', archived_at timestamptz,
 summary jsonb NOT NULL DEFAULT '[]', summary_version integer NOT NULL DEFAULT 0, summary_until_seq integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id), FOREIGN KEY(research_session_id,owner_id,project_id) REFERENCES research_sessions(id,owner_id,project_id) ON DELETE CASCADE
);
CREATE TABLE ai_context_snapshots (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL,
 payload jsonb NOT NULL, hash text NOT NULL, prompt_version text NOT NULL DEFAULT 'gnps-research-v1',
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id)
);
CREATE TABLE ai_requests (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL, client_request_id uuid NOT NULL,
 retry_of uuid REFERENCES ai_requests(id) ON DELETE SET NULL,
 user_message text NOT NULL DEFAULT '', request_fingerprint text NOT NULL DEFAULT '',
 state text NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled','interrupted')),
 provider_id uuid NOT NULL, model_id text NOT NULL, provider_name text NOT NULL, context_snapshot_id uuid REFERENCES ai_context_snapshots(id),
 error_code text, error_message text, lease_until timestamptz, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 UNIQUE(owner_id,client_request_id), FOREIGN KEY(conversation_id,owner_id) REFERENCES ai_conversations(id,owner_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ai_one_active_conversation ON ai_requests(conversation_id) WHERE state IN ('queued','running');
CREATE INDEX ai_requests_owner_date ON ai_requests(owner_id,started_at DESC);
CREATE TABLE ai_messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
 sequence integer NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL DEFAULT '',
 request_id uuid NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
 status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,sequence)
);
CREATE TABLE ai_tool_runs (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
 tool_name text NOT NULL, arguments jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_usage (
 request_id uuid PRIMARY KEY REFERENCES ai_requests(id) ON DELETE CASCADE,
 input_tokens integer, output_tokens integer, usage_source text NOT NULL DEFAULT 'unknown',
 reserved_tokens integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_daily_budgets (
 owner_id uuid NOT NULL REFERENCES users(id), day date NOT NULL,
 requests integer NOT NULL DEFAULT 0, test_requests integer NOT NULL DEFAULT 0, reserved_tokens bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,day)
);
CREATE INDEX ai_conversation_history ON ai_conversations(owner_id,research_session_id,updated_at DESC);
CREATE INDEX ai_snapshot_owner ON ai_context_snapshots(owner_id,created_at);
CREATE INDEX research_session_history ON research_sessions(owner_id,project_id,last_active_at DESC);
