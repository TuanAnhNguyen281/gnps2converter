-- User-authored Word templates (TipTap JSON) bound to report fields.
CREATE TABLE report_templates (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
 content jsonb NOT NULL, page jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_templates_owner ON report_templates(owner_id,updated_at DESC);
