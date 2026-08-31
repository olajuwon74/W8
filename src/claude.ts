import { x402Fetch } from "./lib/commons-x402";
import type { ProductEnv } from "./runtime";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
}

// Routes the agent's reasoning calls through Commonsmade's x402 Anthropic
// proxy (free during the hackathon, funded from the app's Commons
// balance) instead of a separately-billed Anthropic API key.
export async function askClaude(
  env: ProductEnv,
  messages: ClaudeMessage[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<string> {
  const base = env.COMMONS_X402_API_URL ?? "";
  const res = await x402Fetch(`${base}/anthropic/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
    }),
  });

  if (res.status === 402) {
    const body = (await res.json()) as {
      required_amount: string;
      currency: string;
      balance: string;
      provider: string;
    };
    throw new Error(
      `x402 payment required for anthropic (balance ${body.balance} ${body.currency})`
    );
  }

  if (!res.ok) {
    throw new Error(`Claude call failed with status ${res.status}`);
  }

  const data = (await res.json()) as ClaudeResponse;
  return data.content.map((c) => c.text).join("");
}
