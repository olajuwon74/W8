import { x402Fetch } from "@commons/x402-helper";

// Thin wrapper around the Commonsmade x402 proxy, using the platform's own
// helper package (@commons/x402-helper) rather than a raw fetch — the
// helper handles signing the payment token before forwarding to the real
// provider. `requestUrl` is unused now (the helper resolves same-origin
// paths itself) but kept in the signature so call sites don't need to
// change if that ever stops being true.
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
  _requestUrl: string,
  provider: string,
  path: string,
  init: RequestInit
): Promise<X402Result<T>> {
  const res = await x402Fetch(`/x402/${provider}/${path}`, init);

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
