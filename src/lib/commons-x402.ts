/**
 * commons-x402 — call paid x402 APIs through the Commons paid-only buyer proxy.
 *
 * Installed by the platform (`install_x402_helper` tool); after installation
 * this file belongs to the app — edit it if a specific seller needs something
 * unusual, but the defaults below cover the protocol correctly.
 *
 * Every successful payment spends the app owner's real money. Cache paid
 * responses, keep paid calls behind explicit user actions, and always pass a
 * per-call ceiling.
 */

export interface X402Env {
	COMMONS_X402_API_URL?: string;
	COMMONS_X402_API_KEY?: string;
}

export interface X402Target {
	/** The paid API URL (https). */
	url: string;
	/** HTTP method, default GET. */
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
	/** Forwarded to the target (your seller API keys included). */
	headers?: Record<string, string>;
	/** Text request body. For binary payloads use `bodyB64` instead. */
	body?: string;
	/** Base64-encoded binary request body. */
	bodyB64?: string;
}

export type X402PaymentState = 'settled' | 'unknown' | 'unsupported';

export interface X402Payment {
	/**
	 * "settled": paid and confirmed. "unknown": response delivered but the
	 * receipt is missing — the platform reconciles on-chain within minutes
	 * (do NOT retry immediately: a retry is a second payment). "unsupported":
	 * the target wants a payment the platform cannot make.
	 */
	state: X402PaymentState;
	amount_usdc?: string;
	asset?: string;
	network?: string;
	pay_to?: string;
	transaction?: string | null;
	reference?: string;
	error?: string | null;
	/** Only for "unsupported": why the payment cannot be made. */
	reason?: string;
}

export interface X402Envelope {
	request_id: string;
	/** The target's HTTP status (the proxy call itself returned 200). */
	status: number;
	headers: Record<string, string>;
	body: string;
	body_encoding: 'utf-8' | 'base64';
	/** Payment outcome. Free target responses are rejected, never enveloped. */
	payment: X402Payment;
}

/**
 * A refusal from the proxy itself (the target was never reached, or the
 * payment was refused before it left). `type` is stable and branchable:
 * - "insufficient_balance" — the owner must top up on the platform.
 * - "payment_limit_exceeded" — price above your ceiling or the platform cap.
 * - "spend_limit_exceeded"  — the owner's daily x402 allowance is spent.
 * - "rate_limited"          — too many payments this minute; back off.
 * - "free_resource_not_allowed" — target did not answer 402; no target
 *   response bytes were relayed. Use direct server-side fetch if intended.
 * - "invalid_target"        — not a public https URL.
 * - "upstream_error" / "chain_unavailable" — transient; if detail carries
 *   payment_state "unknown" a payment may have left — never blind-retry.
 * - "not_configured"        — x402 is off platform-side; degrade gracefully.
 * - "auth_error"            — key unset/revoked (re-provision via the Env tab).
 */
export class X402Error extends Error {
	constructor(
		readonly type: string,
		readonly status: number,
		message: string,
		readonly detail?: Record<string, unknown>,
	) {
		super(message);
		this.name = 'X402Error';
	}
}

export function isX402Configured(env: X402Env): boolean {
	return Boolean(env.COMMONS_X402_API_URL && env.COMMONS_X402_API_KEY);
}

async function callProxy(
	env: X402Env,
	target: X402Target,
	maxAmountUsdc: string,
	stream: boolean,
): Promise<Response> {
	if (!isX402Configured(env)) {
		throw new X402Error(
			'not_configured',
			503,
			'Paid API calls are not configured for this app (check the Env tab).',
		);
	}
	const { bodyB64, ...rest } = target;
	const res = await fetch(`${env.COMMONS_X402_API_URL}/proxy`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${env.COMMONS_X402_API_KEY}`,
		},
		body: JSON.stringify({
			...rest,
			...(bodyB64 !== undefined ? { body_b64: bodyB64 } : {}),
			max_amount_usdc: maxAmountUsdc,
			stream,
		}),
	});
	if (!res.ok) {
		let detail: Record<string, unknown> | undefined;
		try {
			detail = ((await res.json()) as { detail?: Record<string, unknown> }).detail;
		} catch {
			// Non-JSON error body; the status alone has to do.
		}
		const type = typeof detail?.type === 'string' ? detail.type : 'upstream_error';
		const message =
			typeof detail?.message === 'string'
				? detail.message
				: `Paid API call failed (${res.status})`;
		throw new X402Error(type, res.status, message, detail);
	}
	return res;
}

/**
 * Call a paid API; the platform performs the x402 payment handshake
 * from the owner's balance and returns the paid response as an envelope.
 *
 * `maxAmountUsdc` is your per-call ceiling on the owner's money — pick it
 * from the probed price of the endpoint, not "high just in case".
 *
 * The proxy is paid-only. A target that does not answer HTTP 402 is rejected
 * with `free_resource_not_allowed`; its response is never relayed. Call
 * known-free APIs directly from server-side code.
 */
export async function paidFetch(
	env: X402Env,
	target: X402Target,
	maxAmountUsdc: string,
): Promise<X402Envelope> {
	const res = await callProxy(env, target, maxAmountUsdc, false);
	return (await res.json()) as X402Envelope;
}

/**
 * Streaming variant for SSE / AI-token / long responses: resolves as a raw
 * `Response` whose body is the target's live stream and whose headers carry
 * the payment receipt (read it with `paymentFromHeaders`).
 *
 * Money rules for streams — the payment happens ONCE at stream start:
 * - NEVER point a browser `EventSource` at a paid stream (it reconnects
 *   forever; every reconnect is a new payment). Hold one paid upstream
 *   stream in the App DO and fan it out to browsers yourself.
 * - No automatic reconnect loops; surface interruptions and let the user
 *   retry deliberately. Truncated SSE streams end with a comment line
 *   `: commons-x402 stream truncated (<reason>)`.
 */
export async function paidStream(
	env: X402Env,
	target: X402Target,
	maxAmountUsdc: string,
): Promise<Response> {
	return callProxy(env, target, maxAmountUsdc, true);
}

/** The payment receipt of a `paidStream` response. */
export function paymentFromHeaders(headers: Headers): X402Payment {
	const rawState = headers.get('x-commons-x402-payment-state');
	if (!rawState) {
		throw new X402Error(
			'upstream_error',
			502,
			'Paid stream response is missing its x402 payment state.',
		);
	}
	const state = rawState as X402PaymentState;
	const payment: X402Payment = { state };
	const amount = headers.get('x-commons-x402-amount-usdc');
	if (amount) payment.amount_usdc = amount;
	const network = headers.get('x-commons-x402-network');
	if (network) payment.network = network;
	const payTo = headers.get('x-commons-x402-pay-to');
	if (payTo) payment.pay_to = payTo;
	const transaction = headers.get('x-commons-x402-transaction');
	if (transaction) payment.transaction = transaction;
	const reference = headers.get('x-commons-x402-reference');
	if (reference) payment.reference = reference;
	const error = headers.get('x-commons-x402-payment-error');
	if (error) payment.error = error;
	const reason = headers.get('x-commons-x402-unsupported-reason');
	if (reason) payment.reason = reason;
	return payment;
}

/** The envelope body as text (decodes the base64 case). */
export function envelopeText(envelope: X402Envelope): string {
	return envelope.body_encoding === 'base64' ? atob(envelope.body) : envelope.body;
}

/** The envelope body as bytes (for binary responses). */
export function envelopeBytes(envelope: X402Envelope): Uint8Array {
	const raw = envelope.body_encoding === 'base64' ? atob(envelope.body) : envelope.body;
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}
