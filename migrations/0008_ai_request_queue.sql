-- Durable queue: the first-call prompt is stored so any instance can run a queued turn.
ALTER TABLE ai_requests ADD COLUMN prompt jsonb;
ALTER TABLE ai_requests ADD COLUMN worker_id text;
ALTER TABLE ai_requests ADD COLUMN claimed_at timestamptz;
CREATE INDEX ai_requests_queue ON ai_requests(started_at,id) WHERE state='queued';
-- Input tokens the provider reported as served from its prompt cache (subset of input_tokens).
ALTER TABLE ai_usage ADD COLUMN cached_input_tokens integer;
