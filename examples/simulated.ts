/**
 * Offline demo that simulates a character-by-character LLM stream. Useful
 * for seeing partial-zod's progressive output without an API key.
 *
 * Run:
 *   npx tsx examples/simulated.ts
 */
import { z } from "zod";
import { streamParse } from "partial-zod";

const Story = z.object({
  title: z.string(),
  genre: z.string(),
  summary: z.string(),
  characters: z.array(z.object({ name: z.string(), role: z.string() })),
});

const fullJson =
  '{"title":"The Last Signal","genre":"sci-fi thriller","summary":"A xenolinguist deciphers a prime-number broadcast just as her daughter vanishes from the colony.","characters":[{"name":"Dr. Ren Okafor","role":"xenolinguist"},{"name":"Juno","role":"missing daughter"},{"name":"Cmdr. Vikram","role":"skeptical station commander"}]}';

async function* charStream(s: string): AsyncIterable<string> {
  const chunks = s.match(/.{1,6}/g) ?? [];
  for (const c of chunks) {
    await new Promise((r) => setTimeout(r, 35));
    yield c;
  }
}

async function main() {
  let tick = 0;
  for await (const partial of streamParse(charStream(fullJson), Story)) {
    tick++;
    process.stdout.write("\x1Bc");
    console.log(`— partial #${tick} —\n`);
    console.log(JSON.stringify(partial, null, 2));
  }
  console.log("\nStream complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
