# Changelog

All notable changes to partial-zod are documented here.

## 0.1.0 — 2026-04-21

First public release.

### Added
- `streamParse(source, schema)` — async generator yielding `DeepPartial<T>` every time the parsed state strictly changes
- `parsePartial(input, schema)` — non-streaming equivalent
- `repairPartialJson(input)` — low-level repair primitive
- Truncation-tuned repair: strings recover, incomplete numbers/keywords/keys drop until terminated, empty trailing containers roll back (including their leading comma/key/colon in the parent)
- Subpath adapters
  - `partial-zod/openai` — `fromOpenAI`, `fromOpenAIToolCall`
  - `partial-zod/anthropic` — `fromAnthropic`, `fromAnthropicToolUse`
  - `partial-zod/ollama` — `fromOllama`, `fromOllamaNdjson`
  - `partial-zod/fetch` — `fromSSE`, `fromReadableStream`
- Offline char-by-char demo (`npm run demo` or `npx tsx examples/simulated.ts`)
- CI on Node 18, 20, 22

### Constraints
- Zero runtime dependencies; Zod 3.22+ or 4.x as peer
- Node 18+
