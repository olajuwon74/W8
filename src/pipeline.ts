import { estimate, type Mode } from "./estimate";
import { askClaude } from "./claude";
import { teachMeSomething, generateQuiz } from "./sidecontent";
import type { ProductEnv } from "./runtime";

export type { Mode };

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Runs the real task and writes a truthful event stream as it happens.
// Every event here corresponds to something that actually occurred —
// nothing is generated to "sound like progress." For multi-step modes,
// the "real steps" are two genuinely separate Claude calls (outline, then
// full answer) rather than one call — this gives Breadcrumbs/Sonification
// real events to narrate without depending on any external paid data.
export async function runPipeline(
  env: ProductEnv,
  prompt: string,
  mode: Mode,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const emit = (event: string, data: unknown) =>
    writer.write(encoder.encode(sseFormat(event, data)));

  const { bucket, multiStep } = estimate(mode);
  await emit("estimate", { bucket });

  // Single-step side content, fired immediately, independent of the
  // real pipeline below — safe because it never claims to be a finding
  // about this specific run.
  if (mode === "teach_me") {
    try {
      const content = await teachMeSomething(env, prompt);
      await emit("side_content", { kind: "teach_me", ...content });
    } catch (err) {
      await emit("side_content_error", { message: String(err) });
    }
  } else if (mode === "game") {
    try {
      const quiz = await generateQuiz(env, prompt);
      await emit("side_content", { kind: "game", quiz });
    } catch (err) {
      await emit("side_content_error", { message: String(err) });
    }
  }

  let answer: string;

  if (multiStep) {
    await emit("step_start", { type: "outline" });
    const outline = await askClaude(env, [{ role: "user", content: prompt }], {
      maxTokens: 200,
      system:
        "Before writing the full answer, briefly outline your approach " +
        "in 2-3 short bullet points. No preamble.",
    });
    await emit("step_result", { type: "outline", note: "Drafted an approach", outline });

    await emit("step_start", { type: "reasoning" });
    answer = await askClaude(
      env,
      [
        {
          role: "user",
          content: `Your outline:\n${outline}\n\nNow write the full answer to: ${prompt}`,
        },
      ],
      { maxTokens: 1024 }
    );
    await emit("step_result", { type: "reasoning", note: "Synthesized answer" });
  } else {
    await emit("step_start", { type: "reasoning" });
    answer = await askClaude(env, [{ role: "user", content: prompt }], { maxTokens: 1024 });
    await emit("step_result", { type: "reasoning", note: "Synthesized answer" });
  }

  await emit("done", { answer, bucket });
  await writer.close();
}
