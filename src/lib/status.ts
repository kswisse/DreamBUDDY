import type { AnalysisStatus } from "@/lib/dreams";

export type { AnalysisStatus };

export const STATUS_LABEL: Record<AnalysisStatus, string> = {
  none: "Not analyzed",
  running: "Analyzing…",
  done: "Analyzed",
  failed: "Analysis failed",
};
