# partial-zod

[![npm](https://img.shields.io/npm/v/partial-zod.svg)](https://www.npmjs.com/package/partial-zod)
[![CI](https://github.com/miller-joe/partial-zod/actions/workflows/ci.yml/badge.svg)](https://github.com/miller-joe/partial-zod/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/partial-zod.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/partial-zod)](https://bundlephobia.com/package/partial-zod)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)

Streaming JSON parser for LLM outputs. Yields typed Zod partials as the stream arrives. Zero runtime deps beyond Zod. Native adapters for OpenAI, Anthropic, Ollama, and raw `fetch`/SSE.

```ts
import { streamParse } from "partial-zod";
import { fromOpenAI } from "partial-zod/openai";

for await (const partial of streamParse(fromOpenAI(stream), MySchema)) {
  // { name: "ac" }
  // { name: "acme", price: 49.99 }
  // { name: "acme", price: 49.99, tags: ["elec"] }
  // ...
}
```

See [`examples/`](./examples/) for a fully offline demo you can run without any API key.

## vs. zod-stream

[`zod-stream`](https://github.com/hack-dance/island-ai) is the established library in this niche. It's part of the Instructor-JS / hack-dance stack and works well if you're already using it. partial-zod exists for when you aren't: one function, no ecosystem buy-in, no runtime dependencies past Zod.

| | zod-stream | partial-zod |
|---|---|---|
| API | `ZodStream(...)` client class | `streamParse(source, schema)` function |
| Ecosystem | Instructor-JS / hack-dance | None |
| OpenAI | Native | Native |
| Anthropic / Ollama / raw fetch | Via `llm-polyglot` wrapper | Native subpath adapters |
| Tool-call streaming | Yes | Yes (OpenAI `tool_calls`, Anthropic `input_json_delta`) |
| Runtime dependencies | Several | Zero (Zod is a peer) |

## Install

```bash
npm install partial-zod zod
```

Node 18+. Zod 3.22+ or 4.x as a peer.

## Usage

### OpenAI

```ts
import { z } from "zod";
import { streamParse } from "partial-zod";
import { fromOpenAI } from "partial-zod/openai";
import OpenAI from "openai";

const Product = z.object({
  name: z.string(),
  price: z.number(),
  tags: z.array(z.string()),
});

const completion = await new OpenAI().chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Generate a product listing as JSON." }],
  stream: true,
  response_format: { type: "json_object" },
});

for await (const partial of streamParse(fromOpenAI(completion), Product)) {
  console.log(partial);
}
```

Tool-call streaming (JSON arrives in `delta.tool_calls[i].function.arguments`):

```ts
import { fromOpenAIToolCall } from "partial-zod/openai";
for await (const partial of streamParse(fromOpenAIToolCall(completion), Schema)) { }
```

### Anthropic

```ts
import { streamParse } from "partial-zod";
import { fromAnthropic } from "partial-zod/anthropic";
import Anthropic from "@anthropic-ai/sdk";

const stream = new Anthropic().messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Respond with JSON: { ... }" }],
});

for await (const partial of streamParse(fromAnthropic(stream), Product)) { }
```

Tool-use streaming (`input_json_delta.partial_json`):

```ts
import { fromAnthropicToolUse } from "partial-zod/anthropic";
for await (const partial of streamParse(fromAnthropicToolUse(stream), ToolInputSchema)) { }
```

### Ollama

Client:

```ts
import ollama from "ollama";
import { fromOllama } from "partial-zod/ollama";

const stream = await ollama.chat({
  model: "llama3.2",
  messages: [{ role: "user", content: "JSON: { ... }" }],
  stream: true,
  format: "json",
});
for await (const partial of streamParse(fromOllama(stream), Product)) { }
```

Raw HTTP, no `ollama` client:

```ts
import { fromOllamaNdjson } from "partial-zod/ollama";

const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  body: JSON.stringify({ model: "llama3.2", messages: [...], stream: true, format: "json" }),
});
for await (const partial of streamParse(fromOllamaNdjson(res.body!), Product)) { }
```

### Raw fetch + SSE

Any provider using SSE framing (`data: ...\n\n`):

```ts
import { streamParse } from "partial-zod";
import { fromSSE } from "partial-zod/fetch";

const res = await fetch(url, { /* ... */ });
const text = fromSSE(res.body!, {
  transform: (payload) => JSON.parse(payload).choices[0].delta.content ?? null,
});
for await (const partial of streamParse(text, Product)) { }
```

For raw byte streams with no framing, use `fromReadableStream`.

## API

**`streamParse(source, schema, options?)`**

- `source`: `AsyncIterable<string>`, text chunks (decoded to UTF-8 string, not bytes).
- `schema`: any `ZodTypeAny`.
- `options.transformChunk?: (chunk: string) => string | null` preprocesses each raw chunk (e.g. strips SSE framing). Return `null` to skip.

Returns `AsyncGenerator<DeepPartial<T>>` that yields each time the parsed state strictly changes.

**`parsePartial(input, schema)`**

Non-streaming equivalent. Takes a full (possibly truncated) JSON string and returns the best-effort `DeepPartial<T>`.

**`repairPartialJson(input)`**

The low-level repair primitive. Takes a possibly-truncated JSON string, returns a valid JSON string representing the best interpretation available.

## How the repair works

The repair is tuned for one failure mode: a valid JSON string truncated at an arbitrary position (which is what LLM streams produce when you look at the buffer mid-response). It walks the buffer as a tokenizer, tracks a stack of open contexts, records a "last safe end" within each context after every complete member, and on EOF rolls back any partial trailing member before closing the stack.

Key choices that keep partial emissions stable:

- Strings recover. The parser closes them with a synthetic `"`, backing off any dangling escape.
- Incomplete numbers drop until terminated. A trailing `49` could still be receiving digits (becoming `493`), so numbers need a terminator (comma, brace, whitespace) before committing.
- Incomplete keywords drop. `tru`, `fa`, `nu` are not committed until their final character arrives.
- Incomplete keys drop. Object keys still being streamed are dropped together with their pair.
- Empty trailing containers drop. If a nested object or array has been entered but no complete member has arrived by EOF, the whole container is rolled back, including the parent's leading comma, key, and colon. You don't see `{ items: [{x:1}, {}] }` blink into existence before `{ items: [{x:1}, {x:2}] }`.

## Roadmap

Shipped in v0.1: the core parser, Zod-aware partials, truncation-tuned repair, adapters for OpenAI / Anthropic / Ollama / raw fetch, and tool-call streaming.

Planned, in no particular order:

- Discriminated unions with best-effort variant selection as partials stream in.
- Vitest matcher helpers for asserting intermediate partial states.
- Async schema-guided repair that drops fields whose types can't match even after repair.

Issues and PRs welcome.

## License

MIT
