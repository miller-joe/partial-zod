/**
 * Low-level adapters for raw fetch responses.
 *
 * Use these when your LLM client returns a plain `ReadableStream<Uint8Array>`
 * (e.g. `fetch("...")`'s `response.body`). The `fromSSE` adapter parses
 * server-sent-events framing (`data: ...\n\n`), which is what OpenAI,
 * Anthropic, and most hosted providers use on the wire.
 */

/**
 * Decode a `ReadableStream<Uint8Array>` (or any iterable of bytes) into a
 * stream of UTF-8 string chunks. Does not parse any framing — chunks land
 * as-is.
 */
export async function* fromReadableStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  const it = toAsyncIterable(source);
  for await (const chunk of it) {
    const text =
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (text.length > 0) yield text;
  }
  const tail = decoder.decode();
  if (tail.length > 0) yield tail;
}

/**
 * Parse a server-sent events stream (`data: ...\n\n` framing) and yield
 * the string payload of each `data:` line. Ignores lines starting with
 * any other SSE field (`event:`, `id:`, `retry:`, `:` comments).
 *
 * By default, the sentinel payload `[DONE]` (used by OpenAI to signal
 * stream termination) is swallowed. Pass `emitDone: true` to surface it.
 */
export interface FromSSEOptions {
  emitDone?: boolean;
  /**
   * Called on each parsed data payload before yielding. Return `null` to
   * drop the frame. Useful for extracting a JSON field from each frame
   * (e.g. `JSON.parse(s).choices[0].delta.content`).
   */
  transform?: (dataPayload: string) => string | null;
}

export async function* fromSSE(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
  options: FromSSEOptions = {},
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const it = toAsyncIterable(source);
  for await (const chunk of it) {
    buffer +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });

    // Frames are separated by `\n\n`. A frame is a sequence of lines.
    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const payload = extractDataPayload(frame);
      if (payload === null) continue;
      if (!options.emitDone && payload === "[DONE]") continue;
      const out = options.transform ? options.transform(payload) : payload;
      if (out !== null && out.length > 0) yield out;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const payload = extractDataPayload(buffer);
    if (payload !== null && (options.emitDone || payload !== "[DONE]")) {
      const out = options.transform ? options.transform(payload) : payload;
      if (out !== null && out.length > 0) yield out;
    }
  }
}

function extractDataPayload(frame: string): string | null {
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function toAsyncIterable<T>(
  source: ReadableStream<T> | AsyncIterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in source) {
    return source;
  }
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
