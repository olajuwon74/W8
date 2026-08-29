import { askClaude } from "./claude";
import type { ProductEnv } from "./runtime";

// Single-step modes: no dependency on the real event stream, safe to
// generate from the prompt alone, any time. Fired in parallel with the
// main pipeline so they're ready almost instantly.

export async function teachMeSomething(
  env: ProductEnv,
  prompt: string
): Promise<{ concept: string; explanation: string }> {
  const text = await askClaude(env, [{ role: "user", content: prompt }], {
    maxTokens: 200,
    system:
      "The user asked a question and is waiting for the real answer. " +
      "In under 60 words, teach them ONE relevant concept they'll " +
      "encounter in that answer. Respond as JSON: " +
      '{"concept": "short name", "explanation": "1-2 sentence explanation"}. ' +
      "No preamble, JSON only.",
  });
  return JSON.parse(text);
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export async function generateQuiz(
  env: ProductEnv,
  prompt: string
): Promise<QuizQuestion[]> {
  const text = await askClaude(env, [{ role: "user", content: prompt }], {
    maxTokens: 400,
    system:
      "The user asked a question and is waiting for the real answer. " +
      "Generate 2 short multiple-choice trivia questions related to the " +
      "topic (not the specific answer itself). Respond as JSON: " +
      '[{"question": "...", "options": ["A", "B", "C"], "correctIndex": 0}]. ' +
      "No preamble, JSON only.",
  });
  return JSON.parse(text);
}
