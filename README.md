# partial-zod

[![npm](https://img.shields.io/npm/v/partial-zod.svg)](https://www.npmjs.com/package/partial-zod)
[![CI](https://github.com/miller-joe/partial-zod/actions/workflows/ci.yml/badge.svg)](https://github.com/miller-joe/partial-zod/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/partial-zod.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/partial-zod)](https://bundlephobia.com/package/partial-zod)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/miller-joe?style=social&logo=github)](https://github.com/sponsors/miller-joe)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/indivisionjoe)

**The lightweight, framework-agnostic streaming JSON parser for LLM outputs.** Zod-typed partials as each chunk arrives, zero runtime deps beyond Zod, and native adapters for OpenAI, Anthropic, Ollama, and raw `fetch`/SSE.

```ts
import { streamParse } from "partial-zod";
import { fromOpenAI } from "partial-zod/openai";

for await (const partial of streamParse(fromOpenAI(stream), MySchema)) {
  // { name: "ac" } → { name: "acme", price: 49.99 } → { name: "acme", price: 49.99, tags: ["elec"] } → ...
}
```

See [`examples/`](./examples/) for a fully offline demo you can run without any API key.

## Why this, not [`zod-stream`](https://github.com/hack-dance/island-ai)?

`zod-stream` is the established player in this niche (part of the Instructor-JS / hack-dance stack). It's great if you're already inside that ecosystem. `partial-zod` exists for the cases where you're not:

| | zod-stream | **partial-zod** |
|---|---|---|
| API shape | Client class (`ZodStream(...)`) | Single function (`streamParse(src, schema)`) |
| Tied to an SDK ecosystem | Instructor-JS / hack-dance | None |
| OpenAI support | Native | Native |
| Anthropic / Ollama / raw fetch | Via `llm-polyglot` (OpenAI-compatible wrapper) | Native subpath adapters |
| Tool-call streaming | ✅ | ✅ (OpenAI `tool_calls`, Anthropic `input_json_delta`) |
| Runtime dependencies | Several | **Zero** (Zod is a peer) |
| Package size (minzip) | Larger (monorepo deps) | ~10 KB |

Use `zod-stream` if you want the full Instructor experience. Use `partial-zod` if you want a single function, zero deps, and no opinions about which SDK you use.

## Why partial streaming matters

LLMs stream *text*. If you asked for JSON, the JSON arrives in fragments:

```
t=0ms:   {
t=200ms: {"name":
t=400ms: {"name": "ac
t=600ms: {"name": "acme", "price":
t=800ms: {"name": "acme", "price": 49.99, "tags": ["elec
```

None of those in-between strings are valid JSON, so `JSON.parse` throws. `partial-zod` buffers the stream, auto-repairs the partial JSON, validates against your Zod schema, and yields a typed `Partial<T>` each time the state changes. Your UI can render as the response arrives instead of waiting for the final token.

## Install

```bash
npm install partial-zod zod
```

Node ≥ 18. Zod 3.22+ or 4.x as a peer dependency.

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

For tool-call streaming (JSON arrives in `delta.tool_calls[i].function.arguments`):

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

Raw HTTP (no `ollama` client):

```ts
import { fromOllamaNdjson } from "partial-zod/ollama";

const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  body: JSON.stringify({ model: "llama3.2", messages: [...], stream: true, format: "json" }),
});
for await (const partial of streamParse(fromOllamaNdjson(res.body!), Product)) { }
```

### Raw fetch + SSE

For any provider with SSE framing (`data: ...\n\n`):

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

### `streamParse(source, schema, options?)`

- `source: AsyncIterable<string>` — text chunks (decoded to UTF-8 string, not bytes or tokens)
- `schema: ZodTypeAny` — Zod schema describing the expected output
- `options.transformChunk?: (chunk: string) => string | null` — preprocess each raw chunk (e.g. strip SSE framing). Return `null` to skip a chunk.

Returns `AsyncGenerator<DeepPartial<T>>` that yields each time the parsed state strictly changes.

### `parsePartial(input, schema)`

Non-streaming equivalent — takes a full (possibly truncated) JSON string and returns the best-effort `DeepPartial<T>`. Useful for testing, and for endpoints that batch the final truncated response.

### `repairPartialJson(input)`

The low-level repair primitive. Takes a possibly-truncated JSON string and returns a valid JSON string representing the best-effort interpretation. Useful if you want to do your own validation on top.

## How the repair works

`partial-zod` is tuned for the narrow class of errors LLM streams produce: a valid JSON string truncated at an arbitrary position. It walks the buffer as a tokenizer, tracks a stack of open contexts (objects and arrays), records a "last safe end" within each context after every complete member, and on EOF rolls back any partial trailing member and closes the stack.

Conservative choices to keep partial emissions stable:

- **Strings recover** — close with a synthetic `"`, backing off any dangling escape sequence.
- **Incomplete numbers drop** — `49` at EOF could still be receiving digits (becoming `493`), so numbers require a terminator (comma, closing brace, whitespace) to be considered complete.
- **Incomplete keywords drop** — `tru`, `fa`, `nu` are dropped until their final character arrives.
- **Incomplete keys drop** — object keys still being streamed are dropped along with their pair.
- **Empty trailing containers drop** — if we entered an object/array but haven't completed a single member by EOF, the whole container is rolled back *including* the parent's leading comma/key/colon, so you don't see `{ items: [{x:1}, {}] }` blink into existence before `{ items: [{x:1}, {x:2}] }`.

## Roadmap

- [x] Core streaming parser + Zod schema-aware partials
- [x] Auto-repair for strings, arrays, objects, numbers, keywords, trailing commas
- [x] Adapters: `partial-zod/openai`, `partial-zod/anthropic`, `partial-zod/ollama`, `partial-zod/fetch`
- [x] Tool-call streaming (OpenAI `tool_calls`, Anthropic `input_json_delta`)
- [ ] Discriminated unions (best-effort variant selection as partials stream in)
- [ ] Vitest matcher helpers for asserting partial states
- [ ] Async schema-guided repair (drop fields whose types can't match even after repair)

## License

MIT
