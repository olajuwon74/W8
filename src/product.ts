import type { ProductHandler } from './runtime';
import {
  paidFetch,
  paidStream,
  envelopeText,
  isX402Configured,
  X402Error,
} from './lib/commons-x402';

// BlockRun is a grant-sponsored, OpenAI-compatible LLM provider at a flat
// $0.027925/call (probed via sol.blockrun.ai). A hackathon grant pays each
// call, so the owner's own x402 balance is untouched. This is the per-call
// ceiling sent to the proxy.
const MAX_USDC_PER_CALL = '0.03';

const CHAT_URL = 'https://sol.blockrun.ai/api/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

function chatBody(prompt: string, maxTokens: number, stream: boolean): string {
  return JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
  });
}

function chatHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

/** Extract the assistant text from an OpenAI-compatible /chat/completions response. */
function extractMessage(data: any): string {
  return (data?.choices?.[0]?.message?.content || '').toString().trim();
}

/**
 * Non-streaming chat call through the x402 proxy for side content
 * (Teach Me / Game). Returns the assistant text.
 */
async function callChat(env: any, prompt: string): Promise<string> {
  const target = {
    url: CHAT_URL,
    method: 'POST' as const,
    headers: chatHeaders(),
    body: chatBody(prompt, 1024, false),
  };
  const envelope = await paidFetch(env, target, MAX_USDC_PER_CALL);
  if (envelope.status !== 200) {
    throw new Error(`blockrun ${envelope.status}: ${envelopeText(envelope)}`);
  }
  return extractMessage(JSON.parse(envelopeText(envelope)));
}

/**
 * Streaming chat answer call for the main response. The proxy pays once at
 * stream start; we hold that single paid stream in the App DO and fan the
 * tokens out to the browser SSE — never point the browser at a paid stream.
 */
async function* streamAnswer(env: any, prompt: string): AsyncGenerator<string> {
  const target = {
    url: CHAT_URL,
    method: 'POST' as const,
    headers: chatHeaders(),
    body: chatBody(prompt, 2048, true),
  };
  const res = await paidStream(env, target, MAX_USDC_PER_CALL);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`blockrun ${res.status}: ${detail}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const evt = JSON.parse(payload);
          const dt = evt?.choices?.[0]?.delta?.content;
          if (dt) yield dt;
        } catch {
          // SSE comments / keep-alives
        }
      }
    }
  }
}

export const handleProductRequest: ProductHandler = async (request, context) => {
  const url = new URL(request.url);

  if (url.pathname === '/api/respond' && request.method === 'POST') {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const q = String(body.q || '').trim();
    const modes: string[] = Array.isArray(body.modes) ? body.modes : [];

    if (!q) {
      return Response.json({ error: 'Empty prompt' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const send = (obj: any) => {
      writer.write(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n'));
    };

    const run = async () => {
      const useGame = modes.includes('game');
      const useTeach = modes.includes('teach');
      const useBread = modes.includes('breadcrumbs');
      const useSonic = modes.includes('sonification');

      try {
        if (!isX402Configured(context.env)) {
          throw new Error('Paid AI access is not configured. Add COMMONS_X402_API_URL / COMMONS_X402_API_KEY in the Env tab.');
        }

        let breadSteps: string[] = [];
        if (useBread) {
          // A cheap paid call that returns two outline headings describing
          // how the answer will be built — the breadcrumbs are drawn from
          // this real content instead of static phrasing.
          try {
            const outlineText = await callChat(
              context.env,
              'You are outlining an answer. Return ONLY a JSON array of exactly two short strings (6-10 words each) that describe how you would answer this question, in the order you would think about it. No markdown, no other text.\n\nQuestion: ' + q,
            );
            const cleaned = (outlineText.match(/\[[\s\S]*\]/) || [])[0] || outlineText;
            const arr = JSON.parse(cleaned);
            breadSteps = Array.isArray(arr) ? arr.map(String).slice(0, 2) : [];
          } catch {
            breadSteps = [];
          }
          const first = Array.isArray(breadSteps) && breadSteps[0]
            ? breadSteps[0]
            : 'Parsing your question';
          send({ type: 'step', label: first, detail: 'Reading intent and scope' });
        }

        let gameReady: string | null = null;

        const teachTask = useTeach
          ? callChat(
              context.env,
              'You produce a single short educational concept snippet (max 90 words) related to the user question. Plain text only, no headings or markdown, no JSON.\n\nUser question: ' + q,
            ).then((t) => send({ type: 'teach', text: t }))
          : Promise.resolve();

        const gameTask = useGame
          ? callChat(
              context.env,
              'You produce exactly two trivia questions, each as a JSON object {"question": "…", "options": ["A","B","C","D"], "answer": 0}. Return ONLY a JSON array of the two objects, no other text.\n\nTopic: ' + q,
            ).then((t) => {
              gameReady = t;
            })
          : Promise.resolve();

        if (useGame) {
          await Promise.all([gameTask, teachTask]);
        } else {
          await teachTask;
          await gameTask;
        }

        if (gameReady && useGame) {
          let parsed: any[] = [];
          try {
            const cleaned = (gameReady.match(/\[[\s\S]*\]/) || [gameReady])[0];
            const arr = JSON.parse(cleaned);
            if (Array.isArray(arr)) parsed = arr.slice(0, 2);
          } catch {
            parsed = [];
          }
          if (parsed.length) send({ type: 'game', questions: parsed });
        }

        if (useBread) {
          const second = Array.isArray(breadSteps) && breadSteps[1]
            ? breadSteps[1]
            : 'Forming the response';
          send({ type: 'step', label: second, detail: 'Streaming the final answer' });
        }

        if (useSonic) send({ type: 'sonic', action: 'start' });

        for await (const token of streamAnswer(context.env, q)) {
          send({ type: 'token', text: token });
          if (useSonic) {
            send({ type: 'sonic', note: pitch(token) });
          }
        }

        if (useSonic) send({ type: 'sonic', action: 'stop' });
        send({ type: 'done' });
      } catch (err: any) {
        let message: string;
        if (err instanceof X402Error) {
          switch (err.type) {
            case 'insufficient_balance':
              message = 'Paid AI access ran out. The hackathon grant may not cover this provider, or the owner needs to add funding.';
              break;
            case 'payment_limit_exceeded':
            case 'spend_limit_exceeded':
              message = 'The x402 spend limit was hit.';
              break;
            case 'free_resource_not_allowed':
              message = 'The AI provider requires payment and did not negotiate.';
              break;
            case 'not_configured':
              message = 'Paid AI access is not configured for this app.';
              break;
            case 'auth_error':
              message = 'The x402 credential is missing or invalid (reprovision in the Env tab).';
              break;
            default:
              message = `Paid AI call failed (${err.type}).`;
          }
        } else {
          message = String(err?.message || err);
        }
        send({ type: 'error', error: message });
      } finally {
        try {
          writer.close();
        } catch {
          /* already closed */
        }
      }
    };

    void run();
    return new Response(stream.readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  }

  return null;
};

function pitch(text: string): number {
  let s = 0;
  for (let i = 0; i < text.length; i++) s += text.charCodeAt(i);
  return (s % 9) + 1;
}
