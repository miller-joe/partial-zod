/**
 * Streaming an Anthropic JSON response into a Zod schema with partial-zod.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-... npx tsx examples/anthropic.ts
 */
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { streamParse } from "partial-zod";
import { fromAnthropic } from "partial-zod/anthropic";

const Issue = z.object({
  title: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string(),
  tags: z.array(z.string()),
});

const anthropic = new Anthropic();

const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system:
    'Reply with a single JSON object: {title:string, severity:"low"|"medium"|"high"|"critical", summary:string, tags:string[]}. No prose.',
  messages: [
    {
      role: "user",
      content:
        "Production API returning 500s intermittently since Friday. Restart resolves for a few hours then it recurs. Summarize as a JSON issue.",
    },
  ],
});

console.log("Streaming...");
for await (const partial of streamParse(fromAnthropic(stream), Issue)) {
  console.clear();
  console.log(JSON.stringify(partial, null, 2));
}
console.log("\nDone.");
