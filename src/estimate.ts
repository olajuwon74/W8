// Latency Estimator: decides which modes are worth offering. Multi-step
// modes (Breadcrumbs, Sonification) only make sense when the pipeline
// actually does multiple real steps — see pipeline.ts, which runs a real
// two-call sequence (outline, then answer) specifically for those modes.

export type Bucket = "short" | "long";
export type Mode = "minimal" | "teach_me" | "game" | "breadcrumbs" | "sonification";

const MULTI_STEP_MODES: Mode[] = ["breadcrumbs", "sonification"];

export function estimate(mode: Mode): { bucket: Bucket; multiStep: boolean } {
  const multiStep = MULTI_STEP_MODES.includes(mode);
  return { bucket: multiStep ? "long" : "short", multiStep };
}
