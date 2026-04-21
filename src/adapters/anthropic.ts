/**
 * Adapter for Anthropic's message streams.
 *
 * Works with the event stream returned by `anthropic.messages.stream(...)`
 * (each event is one of content_block_start, content_block_delta,
 * content_block_stop, message_start/stop, ping). Only `text_delta` and
 * `input_json_delta` events are surfaced.
 */

export interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
}

/**
 * Extract text deltas from an Anthropic message stream.
 *
 * Emits incremental text from `content_block_delta` / `text_delta` events.
 * Use when the model is emitting JSON as its plain text response.
 */
export async function* fromAnthropic(
  stream: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<string, void, void> {
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta?.type !== "text_delta") continue;
    const text = event.delta.text;
    if (typeof text === "string" && text.length > 0) {
      yield text;
    }
  }
}

/**
 * Extract tool-input JSON deltas from an Anthropic message stream.
 *
 * When using tool use with streaming, Anthropic emits the tool's
 * `input` argument as `input_json_delta.partial_json` chunks. Use this
 * adapter when streamParse'ing a tool-call input schema.
 *
 * Optionally filter to a specific content-block index if the response has
 * multiple tool calls.
 */
export async function* fromAnthropicToolUse(
  stream: AsyncIterable<AnthropicStreamEvent>,
  blockIndex?: number,
): AsyncGenerator<string, void, void> {
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta?.type !== "input_json_delta") continue;
    if (blockIndex !== undefined && event.index !== blockIndex) continue;
    const chunk = event.delta.partial_json;
    if (typeof chunk === "string" && chunk.length > 0) {
      yield chunk;
    }
  }
}
