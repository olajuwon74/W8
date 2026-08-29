import { x402Fetch } from "./lib/commons-x402";
import type { ProductEnv } from "./runtime";

// Thin wrapper around the Commonsmade x402 proxy via the generated helper.
// Assumption (unverified until install_x402_helper's real output is seen):
// the base URL is `${env.COMMONS_X402_API_URL}/<provider>/<path>`. Confirm
// this against the real generated src/lib/commons-x402.ts once available.
export interface X402Result<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  paymentRequired?: {
    required_amount: string;
    currency: string;
    balance: string;
    provider: string;
  };
}

export async function callX402<T = unknown>(
  env: ProductEnv,
  provider: string,
  path: string,
  init: RequestInit
): Promise<X402Result<T>> {
  const base = env.COMMONS_X402_API_URL ?? "";
  const res = await x402Fetch(`${base}/${provider}/${path}`, init);

  if (res.status === 402) {
    const body = (await res.json()) as X402Result<T>["paymentRequired"];
    return { ok: false, status: 402, paymentRequired: body };
  }

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}
