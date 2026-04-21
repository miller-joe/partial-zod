/**
 * Streaming an OpenAI JSON response into a Zod schema with partial-zod.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... npx tsx examples/openai.ts
 */
import { z } from "zod";
import OpenAI from "openai";
import { streamParse } from "partial-zod";
import { fromOpenAI } from "partial-zod/openai";

const Product = z.object({
  name: z.string(),
  price: z.number(),
  tags: z.array(z.string()),
});

const openai = new OpenAI();

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  stream: true,
  response_format: { type: "json_object" },
  messages: [
    {
      role: "system",
      content:
        'You output a single JSON object with shape {name:string, price:number, tags:string[]}.',
    },
    {
      role: "user",
      content: "Generate a JSON product listing for a cyberpunk-themed mug.",
    },
  ],
});

console.log("Streaming...");
for await (const partial of streamParse(fromOpenAI(completion), Product)) {
  console.clear();
  console.log(JSON.stringify(partial, null, 2));
}
console.log("\nDone.");
