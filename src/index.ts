import { runPipeline, type Mode } from "./pipeline";

export interface Env {
  ASSETS: Fetcher;
  X402_BASE_URL: string;
}

const VALID_MODES: Mode[] = [
  "minimal",
  "teach_me",
  "game",
  "breadcrumbs",
  "sonification",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Commons Login (/auth/login, /auth/callback, /auth/logout, /api/me)
    // is provided by the platform itself in front of this worker — we
    // never implement those routes here, only link to them from the
    // frontend and read /api/me client-side.

    if (url.pathname === "/api/respond" && request.method === "POST") {
      const body = (await request.json()) as { prompt?: string; mode?: string };
      const prompt = (body.prompt ?? "").trim();
      const mode = VALID_MODES.includes(body.mode as Mode)
        ? (body.mode as Mode)
        : "minimal";

      if (!prompt) {
        return new Response(JSON.stringify({ error: "prompt is required" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();

      // Don't block the response on the full pipeline — stream as it runs.
      runPipeline(request.url, prompt, mode, writer).catch(async (err) => {
        const encoder = new TextEncoder();
        await writer.write(
          encoder.encode(
            `event: fatal_error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`
          )
        );
        await writer.close();
      });

      return new Response(readable, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
