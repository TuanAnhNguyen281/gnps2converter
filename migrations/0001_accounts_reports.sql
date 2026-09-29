CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL,
 password_hash text, avatar_url text, email_verified_at timestamptz, auth_version integer NOT NULL DEFAULT 0,
 cloud_bytes bigint NOT NULL DEFAULT 0 CHECK (cloud_bytes >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_accounts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider = 'google'), subject text NOT NULL,
 UNIQUE(provider, subject), UNIQUE(user_id, provider)
);
CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamptz NOT NULL);
CREATE INDEX session_expiry ON sessions(expire);
CREATE INDEX session_owner ON sessions((sess->>'userId'));
CREATE TABLE reports (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 data jsonb NOT NULL, source_url text, revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 row_count integer NOT NULL, storage_bytes integer NOT NULL, idempotency_key text,
 media_status text NOT NULL DEFAULT 'pending' CHECK(media_status IN ('pending','ready','failed')), media_errors jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX report_history ON reports(owner_id,updated_at DESC,id DESC);
CREATE TABLE report_rows (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 source_row_id text NOT NULL, position integer NOT NULL, compound_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('matched','ambiguous','unmatched')), selected boolean NOT NULL,
 payload jsonb NOT NULL, UNIQUE(report_id,source_row_id), UNIQUE(report_id,position)
);
CREATE TABLE media_assets (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), public_id text NOT NULL UNIQUE,
 cloud_asset_id text, version text, resource_type text NOT NULL CHECK(resource_type IN ('image','raw')),
 delivery_type text NOT NULL DEFAULT 'authenticated' CHECK(delivery_type = 'authenticated'),
 original_name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes > 0), hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed','deleting','deleted')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_cleanup ON media_assets(state,next_attempt_at);
CREATE INDEX asset_dedup ON media_assets(owner_id,hash,state);
CREATE TABLE report_assets (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES media_assets(id), kind text NOT NULL,
 row_id text, report_revision integer
);
CREATE UNIQUE INDEX report_asset_link ON report_assets(report_id,asset_id,kind,coalesce(row_id,''),coalesce(report_revision,-1));
CREATE INDEX asset_references ON report_assets(asset_id);

