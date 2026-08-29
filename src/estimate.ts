// Latency Estimator: a cheap heuristic run before any real work starts,
// so the Mode Selector only offers experiences that will actually have
// enough time to land. This is intentionally simple (keyword match) rather
// than a model call, so it costs ~0ms.

export type Bucket = "instant" | "short" | "medium" | "long";

const TIME_SENSITIVE = [
  "current", "latest", "today", "now", "price", "weather",
  "news", "recent", "this week", "score", "stock",
];

export interface Estimate {
  needsSearch: boolean;
  bucket: Bucket;
}

export function estimate(prompt: string): Estimate {
  const lower = prompt.toLowerCase();
  const needsSearch = TIME_SENSITIVE.some((kw) => lower.includes(kw));

  // Search-grounded answers involve two real network round trips
  // (search + synthesis), so they land in the "long" bucket where
  // Breadcrumbs/Sonification have real events to narrate. Everything
  // else is a single model call, which is comparatively fast.
  const bucket: Bucket = needsSearch ? "long" : "short";

  return { needsSearch, bucket };
}

// Which modes are valid to offer for a given bucket.
export const MODES_BY_BUCKET: Record<Bucket, string[]> = {
  instant: ["minimal"],
  short: ["minimal", "teach_me", "game"],
  medium: ["minimal", "teach_me", "game", "breadcrumbs", "sonification"],
  long: ["minimal", "teach_me", "game", "breadcrumbs", "sonification"],
};
