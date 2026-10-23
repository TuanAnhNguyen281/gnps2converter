export interface Project {
  id: string;
  name: string;
  description: string;
  research_goal: string;
  archived_at: string | null;
}
export interface Session {
  id: string;
  title: string;
  project_id: string;
  status: "active" | "closed";
  active_report_id: string | null;
  view_state: { selectedRowIds?: string[]; filter?: string; sort?: string };
}
export interface Report {
  id: string;
  title: string;
  revision: number;
  row_count: number;
  project_id?: string | null;
}
export interface Model {
  model_id: string;
  display_name: string;
  enabled: boolean;
  supports_tools: boolean;
  supports_stream: boolean;
  context_limit: number;
  max_output: number;
  input_price_per_million: string | null;
  output_price_per_million: string | null;
  currency: string;
  verified_at: string | null;
}
export interface ProviderQuota {
  monthUsed: number;
  monthLimit: number | null;
  monthUsable: number | null;
  dayUsed: number;
  dayLimit: number | null;
  dayUsable: number | null;
  pending: number;
  estimatedRequests: number;
  reservePercent: number;
  timezone: string;
}
export interface Provider {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  monthly_token_limit: string | number | null;
  daily_token_limit: string | number | null;
  quota_reserve_percent: number;
  quota?: ProviderQuota;
  models: Model[];
}
export interface TokenPreview {
  providerName: string;
  modelId: string;
  calibrated: boolean;
  input: number;
  outputMax: number;
  reserve: number;
  toolRounds: boolean;
  contextLimit: number;
  breakdown: {
    instructions: number;
    data: number;
    history: number;
    question: number;
    tools: number;
  };
  rows: { examined: number; sent: number; truncated: boolean };
  history: { included: number; omitted: number };
  reports: { id: string; title: string; revision: number; rowCount: number }[];
  quota: ProviderQuota;
  fits: boolean;
  reason: string | null;
}
export interface ProbeResult {
  content: string;
  stream: "ok" | "failed";
  streamOptions: "accepted" | "rejected" | null;
  streamUsage: boolean | null;
  tools: "ok" | "failed";
  usage: boolean;
  notes: string[];
}
export interface Conversation {
  id: string;
  title: string;
  archived_at: string | null;
}
export interface Citation {
  ref: string;
  reportId: string | null;
  rowId: string | null;
  status: "ok" | "unseen" | "invalid";
}
export interface Message {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  request_id: string;
  state: string;
  status: string;
  model_id: string;
  provider_name: string;
  error_message: string | null;
  citations?: Citation[] | null;
  finish_reason?: string | null;
}
export interface RequestState {
  contextInfo?: {
    historyIncluded: number;
    historyOmitted: number;
    summaryVersion: number;
    truncated: boolean;
    examinedRows: number;
    returnedRows: number;
  };
  requestId: string;
  state: string;
  content: string;
  citations: Citation[] | null;
  finishReason: string | null;
  error: string | null;
  modelId: string;
  providerName: string;
  snapshotId: string;
  sources: {
    reportId: string;
    title: string;
    revision: number;
    rowIds: string[];
  }[];
  toolRuns: {
    tool_name: string;
    arguments: Record<string, unknown>;
    result: Record<string, unknown>;
  }[];
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    usage_source: string;
    estimated_cost: string | null;
    estimated_max_cost: string | null;
    currency: string | null;
    pricing_version: number | null;
  };
}
