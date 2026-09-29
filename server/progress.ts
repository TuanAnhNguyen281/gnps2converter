export type PipelineProgressStage =
  | "task"
  | "matches"
  | "network"
  | "enrichment"
  | "database"
  | "assets"
  | "complete";

export interface PipelineProgress {
  stage: PipelineProgressStage;
  step: number;
  totalSteps: number;
  percent: number;
  title: string;
  message: string;
  detail?: string;
  current?: number;
  total?: number;
  succeeded?: number;
  failed?: number;
  outcome?: "working" | "success" | "partial";
}

export type ProgressReporter = (progress: PipelineProgress) => void;

export function emitProgress(
  reporter: ProgressReporter | undefined,
  progress: Omit<PipelineProgress, "totalSteps">,
) {
  reporter?.({ ...progress, totalSteps: 6 });
}
