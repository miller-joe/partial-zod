/**
 * Adapter for Ollama's streaming responses.
 *
 * Supports both:
 *  - The `ollama` npm client's async iterators (chunks shaped as
 *    `{ message?: { content }, response? }`), and
 *  - Raw /api/chat or /api/generate HTTP responses (newline-delimited
 *    JSON via {@link fromOllamaNdjson}).
 */

export interface OllamaChunk {
  message?: { content?: string };
  response?: string;
  done?: boolean;
}

/**
 * Extract text deltas from an Ollama client stream (`ollama.chat(...)` or
 * `ollama.generate(...)` with `stream: true`). Yields `message.content`
 * deltas for chat streams and `response` deltas for generate streams.
 */
export async function* fromOllama(
  stream: AsyncIterable<OllamaChunk>,
): AsyncGenerator<string, void, void> {
  for await (const chunk of stream) {
    const content = chunk.message?.content ?? chunk.response;
    if (typeof content === "string" && content.length > 0) {
      yield content;
    }
  }
}

/**
 * Extract text deltas from a raw Ollama HTTP response body
 * (/api/chat or /api/generate with `stream: true`). Ollama emits
 * newline-delimited JSON, one object per token group.
 *
 * Accepts either a `ReadableStream<Uint8Array>` (from `fetch`) or any
 * AsyncIterable of strings/byte chunks.
 */
export async function* fromOllamaNdjson(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = "";

  const it = toAsyncIterable(source);
  for await (const chunk of it) {
    buffer +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      const parsed = safeParse(line);
      if (!parsed) continue;
      const content = parsed.message?.content ?? parsed.response;
      if (typeof content === "string" && content.length > 0) {
        yield content;
      }
    }
  }
  // Flush any trailing decoded bytes with a final empty decode pass.
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const parsed = safeParse(buffer);
    if (parsed) {
      const content = parsed.message?.content ?? parsed.response;
      if (typeof content === "string" && content.length > 0) yield content;
    }
  }
}

function safeParse(s: string): OllamaChunk | null {
  try {
    return JSON.parse(s) as OllamaChunk;
  } catch {
    return null;
  }
}

function toAsyncIterable<T>(
  source: ReadableStream<T> | AsyncIterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in source) {
    return source;
  }
  // ReadableStream is also iterable in Node 18+ and modern browsers, but
  // the `Symbol.asyncIterator` check above may not find it on some
  // runtimes. Wrap with a reader fallback.
  const rs = source as ReadableStream<T>;
  return {
    [Symbol.asyncIterator]: async function* () {
      const reader = rs.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value !== undefined) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
