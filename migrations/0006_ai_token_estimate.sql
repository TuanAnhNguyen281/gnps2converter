-- Observed provider input tokens / app estimate for this model (EMA); NULL until the first completed turn with usage.
ALTER TABLE ai_provider_models ADD COLUMN token_calibration real;
-- Endpoint rejected stream_options (HTTP 400/422); persisted so restarts do not retry it.
ALTER TABLE ai_provider_models ADD COLUMN stream_options_rejected boolean NOT NULL DEFAULT false;
-- Estimated prompt tokens at send time, kept to compare with provider usage.
ALTER TABLE ai_usage ADD COLUMN estimated_input_tokens integer;
-- HMAC of the API key: providers sharing a key share one provider account quota.
ALTER TABLE ai_providers ADD COLUMN key_fingerprint text;
CREATE INDEX ai_providers_key_fingerprint ON ai_providers(key_fingerprint);
-- Provider calls outside chat turns (Chat thử) that still consume provider quota.
CREATE TABLE ai_provider_usage_events (
 id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
 kind text NOT NULL, tokens integer NOT NULL CHECK(tokens >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_provider_usage_events_provider ON ai_provider_usage_events(provider_id,created_at);
