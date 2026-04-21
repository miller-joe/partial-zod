import { describe, it, expect } from "vitest";
import {
  fromOpenAI,
  fromOpenAIToolCall,
  type OpenAIChunk,
} from "../src/adapters/openai.js";
import {
  fromAnthropic,
  fromAnthropicToolUse,
  type AnthropicStreamEvent,
} from "../src/adapters/anthropic.js";
import {
  fromOllama,
  fromOllamaNdjson,
  type OllamaChunk,
} from "../src/adapters/ollama.js";
import { fromReadableStream, fromSSE } from "../src/adapters/fetch.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

function iterable<T>(chunks: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}

function byteStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

describe("fromOpenAI", () => {
  it("extracts content deltas", async () => {
    const chunks: OpenAIChunk[] = [
      { choices: [{ delta: { content: '{"na' } }] },
      { choices: [{ delta: { content: 'me":"ac' } }] },
      { choices: [{ delta: { content: "me\"}" } }] },
      { choices: [{ delta: {} }] },
    ];
    const out = await collect(fromOpenAI(iterable(chunks)));
    expect(out.join("")).toBe('{"name":"acme"}');
  });

  it("skips null and empty content", async () => {
    const chunks: OpenAIChunk[] = [
      { choices: [{ delta: { content: null } }] },
      { choices: [{ delta: { content: "" } }] },
      { choices: [{ delta: { content: "x" } }] },
    ];
    const out = await collect(fromOpenAI(iterable(chunks)));
    expect(out).toEqual(["x"]);
  });
});

describe("fromOpenAIToolCall", () => {
  it("extracts tool_call argument deltas", async () => {
    const chunks: OpenAIChunk[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '":1}' } }] } }] },
    ];
    const out = await collect(fromOpenAIToolCall(iterable(chunks)));
    expect(out.join("")).toBe('{"a":1}');
  });

  it("filters by tool call index", async () => {
    const chunks: OpenAIChunk[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "A" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "B" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "C" } }] } }] },
    ];
    const out = await collect(fromOpenAIToolCall(iterable(chunks), 1));
    expect(out).toEqual(["B"]);
  });
});

describe("fromAnthropic", () => {
  it("extracts text_delta events", async () => {
    const events: AnthropicStreamEvent[] = [
      { type: "message_start" },
      { type: "content_block_start", index: 0 },
      { type: "content_block_delta", delta: { type: "text_delta", text: '{"n' } },
      { type: "content_block_delta", delta: { type: "text_delta", text: 'ame":1}' } },
      { type: "content_block_stop" },
      { type: "message_stop" },
    ];
    const out = await collect(fromAnthropic(iterable(events)));
    expect(out.join("")).toBe('{"name":1}');
  });
});

describe("fromAnthropicToolUse", () => {
  it("extracts input_json_delta events", async () => {
    const events: AnthropicStreamEvent[] = [
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"a":' } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "noise" } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "42}" } },
    ];
    const out = await collect(fromAnthropicToolUse(iterable(events)));
    expect(out.join("")).toBe('{"a":42}');
  });
});

describe("fromOllama (client)", () => {
  it("extracts message.content and response deltas", async () => {
    const chunks: OllamaChunk[] = [
      { message: { content: '{"a' } },
      { message: { content: '":' } },
      { response: "1}" },
      { done: true },
    ];
    const out = await collect(fromOllama(iterable(chunks)));
    expect(out.join("")).toBe('{"a":1}');
  });
});

describe("fromOllamaNdjson (raw http)", () => {
  it("parses newline-delimited JSON from a byte stream", async () => {
    const lines = [
      '{"message":{"content":"{"}}\n',
      '{"message":{"content":"\\"a\\":"}}\n',
      '{"message":{"content":"1}"}}\n',
      '{"done":true}\n',
    ];
    const out = await collect(fromOllamaNdjson(byteStream(lines)));
    expect(out.join("")).toBe('{"a":1}');
  });

  it("handles chunk boundaries that split a JSON line", async () => {
    const rs = byteStream(['{"message":{"con', 'tent":"hi"}}\n', '{"done":true}\n']);
    const out = await collect(fromOllamaNdjson(rs));
    expect(out).toEqual(["hi"]);
  });
});

describe("fromReadableStream", () => {
  it("decodes bytes to UTF-8 text chunks", async () => {
    const rs = byteStream(["hello ", "world"]);
    const out = await collect(fromReadableStream(rs));
    expect(out.join("")).toBe("hello world");
  });

  it("handles multibyte chars split across chunks", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("héllo");
    const rs = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2)); // splits 'é' in half
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const out = await collect(fromReadableStream(rs));
    expect(out.join("")).toBe("héllo");
  });
});

describe("fromSSE", () => {
  it("parses data frames and skips [DONE] sentinel", async () => {
    const rs = byteStream([
      'data: {"a":1}\n\n',
      'data: {"a":2}\n\n',
      "data: [DONE]\n\n",
    ]);
    const out = await collect(fromSSE(rs));
    expect(out).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("ignores comment lines (starting with ':')", async () => {
    const rs = byteStream([": heartbeat\n", 'data: {"x":1}\n\n']);
    const out = await collect(fromSSE(rs));
    expect(out).toEqual(['{"x":1}']);
  });

  it("transform option can extract a JSON field from each frame", async () => {
    const rs = byteStream([
      'data: {"delta":"ab"}\n\n',
      'data: {"delta":"cd"}\n\n',
    ]);
    const out = await collect(
      fromSSE(rs, {
        transform: (p) => {
          try {
            const obj = JSON.parse(p) as { delta?: string };
            return obj.delta ?? null;
          } catch {
            return null;
          }
        },
      }),
    );
    expect(out.join("")).toBe("abcd");
  });

  it("emitDone=true surfaces the sentinel", async () => {
    const rs = byteStream(["data: hello\n\n", "data: [DONE]\n\n"]);
    const out = await collect(fromSSE(rs, { emitDone: true }));
    expect(out).toEqual(["hello", "[DONE]"]);
  });
});
