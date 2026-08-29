import { callX402 } from "./x402";
import type { ProductEnv } from "./runtime";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
}

// Routes the agent's own reasoning calls through the platform's x402
// Anthropic proxy. This is plumbing, not a product feature — the pitch
// frames x402 as an optional add-on, not the core mechanism.
export async function askClaude(
  env: ProductEnv,
  messages: ClaudeMessage[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<string> {
  const result = await callX402<ClaudeResponse>(env, "anthropic", "v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
    }),
  });

  if (!result.ok || !result.data) {
    throw new Error(
      result.paymentRequired
        ? `x402 payment required for anthropic (balance ${result.paymentRequired.balance})`
        : `Claude call failed with status ${result.status}`
    );
  }

  return result.data.content.map((c) => c.text).join("");
}
