-- Reviewed "Kết quả và thảo luận" draft appended to the report's Word export.
CREATE TABLE ai_report_drafts (
 report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE, owner_id uuid NOT NULL REFERENCES users(id),
 content text NOT NULL CHECK(char_length(content) <= 20000), source_request_id uuid REFERENCES ai_requests(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
