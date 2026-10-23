-- One rating per answer from its owner; feeds the evaluation set, never shown to others.
CREATE TABLE ai_feedback (
 request_id uuid PRIMARY KEY REFERENCES ai_requests(id) ON DELETE CASCADE, owner_id uuid NOT NULL REFERENCES users(id),
 rating smallint NOT NULL CHECK(rating IN (-1,1)), comment text NOT NULL DEFAULT '' CHECK(char_length(comment) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- External chemistry lookups (PubChem/NPClassifier) send InChIKey/SMILES out, so they are opt-in per project.
ALTER TABLE projects ADD COLUMN allow_external_lookup boolean NOT NULL DEFAULT false;
CREATE TABLE ai_lookup_cache (
 source text NOT NULL, lookup_key text NOT NULL, payload jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,lookup_key)
);
-- Models that accept image input (mirror plots).
ALTER TABLE ai_provider_models ADD COLUMN supports_vision boolean NOT NULL DEFAULT false;
-- What was attached to the question (e.g. the mirror plot's USIs); the image itself is not kept.
ALTER TABLE ai_requests ADD COLUMN attachments jsonb;
