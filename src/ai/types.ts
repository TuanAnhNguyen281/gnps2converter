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
export interface Provider {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  models: Model[];
}
export interface Conversation {
  id: string;
  title: string;
  archived_at: string | null;
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
