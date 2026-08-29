import { callX402 } from "./x402";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
}

// Routes the agent's own reasoning calls through the platform's x402
// Anthropic proxy (per the provider table: /x402/anthropic/v1/messages).
// This is plumbing, not a product feature — see MEMORY note in README
// about why x402 stays out of the pitch's core framing.
export async function askClaude(
  requestUrl: string,
  messages: ClaudeMessage[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<string> {
  const result = await callX402<ClaudeResponse>(
    requestUrl,
    "anthropic",
    "v1/messages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages,
      }),
    }
  );

  if (!result.ok || !result.data) {
    throw new Error(
      result.paymentRequired
        ? `x402 payment required for anthropic (balance ${result.paymentRequired.balance})`
        : `Claude call failed with status ${result.status}`
    );
  }

  return result.data.content.map((c) => c.text).join("");
}
