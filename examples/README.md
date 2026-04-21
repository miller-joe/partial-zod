# examples

Runnable examples demonstrating partial-zod with real and simulated streams.

| File | What it shows | Requires |
|---|---|---|
| `simulated.ts` | Offline char-by-char stream so you can watch partial emission in a terminal | just `npm i` |
| `openai.ts` | OpenAI `response_format: { type: "json_object" }` streaming | `OPENAI_API_KEY`, `npm i openai` |
| `anthropic.ts` | Anthropic `messages.stream` streaming JSON | `ANTHROPIC_API_KEY`, `npm i @anthropic-ai/sdk` |
| `ollama.ts` | Local Ollama via npm client (default) or raw `/api/chat` NDJSON (`OLLAMA_RAW=1`) | local Ollama at `11434` |

Run any of them with `npx tsx examples/<file>.ts`.

The `simulated.ts` demo is the fastest way to see what partial-zod does — no API key, no cost, watches partial state evolve every ~35ms.
