ALTER TABLE ai_messages ADD COLUMN finish_reason text;
-- Token quota of the provider account (MộtAPI free tier: 2.0M/month without top-up). NULL = no app-side limit.
ALTER TABLE ai_providers ADD COLUMN monthly_token_limit bigint DEFAULT 2000000 CHECK(monthly_token_limit IS NULL OR monthly_token_limit > 0);
ALTER TABLE ai_providers ADD COLUMN daily_token_limit bigint DEFAULT 2000000 CHECK(daily_token_limit IS NULL OR daily_token_limit > 0);
ALTER TABLE ai_providers ADD COLUMN quota_reserve_percent integer NOT NULL DEFAULT 10 CHECK(quota_reserve_percent BETWEEN 0 AND 90);
