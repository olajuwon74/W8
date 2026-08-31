import type { ProductEnv } from "./runtime";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
}

// Direct call to Anthropic's API — no x402, no Commonsmade proxy. Requires
// ANTHROPIC_API_KEY to be set as a secret on the deployed app.
export async function askClaude(
  env: ProductEnv,
  messages: ClaudeMessage[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set on this app");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude call failed with status ${res.status}`);
  }

  const data = (await res.json()) as ClaudeResponse;
  return data.content.map((c) => c.text).join("");
}
