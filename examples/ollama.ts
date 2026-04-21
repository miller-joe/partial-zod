/**
 * Streaming a local Ollama JSON response into a Zod schema with partial-zod.
 *
 * Requires Ollama running locally (default: http://localhost:11434) with a
 * JSON-capable model pulled — llama3.2, mistral, qwen2.5, etc.
 *
 * Run (with the `ollama` npm client):
 *   npx tsx examples/ollama.ts
 *
 * Or the raw-HTTP version below (no client dependency):
 *   OLLAMA_RAW=1 npx tsx examples/ollama.ts
 */
import { z } from "zod";
import { streamParse } from "partial-zod";
import { fromOllama, fromOllamaNdjson } from "partial-zod/ollama";

const Recipe = z.object({
  title: z.string(),
  prepMinutes: z.number(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
});

if (process.env.OLLAMA_RAW) {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2",
      stream: true,
      format: "json",
      messages: [
        {
          role: "user",
          content:
            "Return a JSON recipe for miso-glazed salmon with fields title, prepMinutes, ingredients[], steps[].",
        },
      ],
    }),
  });

  if (!res.body) throw new Error("no response body");
  for await (const partial of streamParse(fromOllamaNdjson(res.body), Recipe)) {
    console.clear();
    console.log(JSON.stringify(partial, null, 2));
  }
} else {
  // Uses the `ollama` npm client. `npm i ollama` first if you run this.
  const { default: ollama } = await import("ollama");
  const stream = await ollama.chat({
    model: "llama3.2",
    stream: true,
    format: "json",
    messages: [
      {
        role: "user",
        content:
          "Return a JSON recipe for miso-glazed salmon with fields title, prepMinutes, ingredients[], steps[].",
      },
    ],
  });

  for await (const partial of streamParse(fromOllama(stream), Recipe)) {
    console.clear();
    console.log(JSON.stringify(partial, null, 2));
  }
}

console.log("\nDone.");
