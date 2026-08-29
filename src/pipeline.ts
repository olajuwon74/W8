import { estimate } from "./estimate";
import { search } from "./search";
import { askClaude } from "./claude";
import { teachMeSomething, generateQuiz } from "./sidecontent";

export type Mode = "minimal" | "teach_me" | "game" | "breadcrumbs" | "sonification";

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Runs the real task and writes a truthful event stream as it happens.
// Every event here corresponds to something that actually occurred —
// nothing is generated to "sound like progress."
export async function runPipeline(
  requestUrl: string,
  prompt: string,
  mode: Mode,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const emit = (event: string, data: unknown) =>
    writer.write(encoder.encode(sseFormat(event, data)));

  const { needsSearch, bucket } = estimate(prompt);
  await emit("estimate", { bucket, needsSearch });

  // Single-step side content, fired immediately, independent of the
  // real pipeline below — safe because it never claims to be a finding
  // about this specific run.
  if (mode === "teach_me") {
    try {
      const content = await teachMeSomething(requestUrl, prompt);
      await emit("side_content", { kind: "teach_me", ...content });
    } catch (err) {
      await emit("side_content_error", { message: String(err) });
    }
  } else if (mode === "game") {
    try {
      const quiz = await generateQuiz(requestUrl, prompt);
      await emit("side_content", { kind: "game", quiz });
    } catch (err) {
      await emit("side_content_error", { message: String(err) });
    }
  }

  let context = "";

  if (needsSearch) {
    await emit("step_start", { type: "search" });
    try {
      const results = await search(requestUrl, prompt);
      context = results.map((r) => `${r.title}: ${r.snippet}`).join("\n");
      await emit("step_result", {
        type: "search",
        note:
          results.length > 0
            ? `Found ${results.length} results — top one: "${results[0].title}"`
            : "No results found",
        results,
      });
    } catch (err) {
      await emit("step_error", { type: "search", message: String(err) });
    }
  }

  await emit("step_start", { type: "reasoning" });
  const answer = await askClaude(
    requestUrl,
    [
      {
        role: "user",
        content: context
          ? `Context from search:\n${context}\n\nQuestion: ${prompt}`
          : prompt,
      },
    ],
    { maxTokens: 1024 }
  );
  await emit("step_result", { type: "reasoning", note: "Synthesized answer" });

  await emit("done", { answer, bucket });
  await writer.close();
}
