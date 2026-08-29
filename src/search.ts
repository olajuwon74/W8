import { callX402 } from "./x402";
import type { ProductEnv } from "./runtime";

interface SerpApiResponse {
  organic_results?: { title: string; snippet: string; link: string }[];
}

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

// Real, paid, per-call external data — the one legitimate use of x402 in
// the base flow. Only invoked when estimate.ts decides the prompt actually
// needs current information; most prompts never call this at all.
export async function search(env: ProductEnv, query: string): Promise<SearchResult[]> {
  const result = await callX402<SerpApiResponse>(
    env,
    "serpapi",
    `v1/search?q=${encodeURIComponent(query)}`,
    { method: "GET" }
  );

  if (!result.ok || !result.data) {
    if (result.paymentRequired) {
      throw new Error(
        `x402 payment required for serpapi (balance ${result.paymentRequired.balance})`
      );
    }
    throw new Error(`Search failed with status ${result.status}`);
  }

  return (result.data.organic_results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    snippet: r.snippet,
    link: r.link,
  }));
}
