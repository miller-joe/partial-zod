/**
 * Adapter for OpenAI's chat completion streams.
 *
 * Works with any stream whose chunks have the shape produced by
 * `openai.chat.completions.create({ ..., stream: true })`. Kept structurally
 * typed so this adapter does not require the `openai` package as a runtime
 * or peer dependency.
 */

export interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        function?: { arguments?: string | null };
      }>;
    };
  }>;
}

/**
 * Extract text deltas from an OpenAI-compatible chat completion stream.
 * Use this when the model emits JSON as its content — e.g. with
 * `response_format: { type: "json_object" }` or `json_schema`.
 */
export async function* fromOpenAI(
  stream: AsyncIterable<OpenAIChunk>,
): AsyncGenerator<string, void, void> {
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      yield delta;
    }
  }
}

/**
 * Extract argument-string deltas from an OpenAI tool-call stream.
 *
 * When using function calling with `stream: true`, the structured JSON for
 * each tool call arrives in `delta.tool_calls[i].function.arguments` deltas
 * instead of `delta.content`.
 *
 * Defaults to tool-call index 0. If a single response includes multiple
 * parallel tool calls, pass the index explicitly.
 */
export async function* fromOpenAIToolCall(
  stream: AsyncIterable<OpenAIChunk>,
  toolCallIndex = 0,
): AsyncGenerator<string, void, void> {
  for await (const chunk of stream) {
    const calls = chunk.choices?.[0]?.delta?.tool_calls;
    if (!calls) continue;
    for (const call of calls) {
      if ((call.index ?? 0) !== toolCallIndex) continue;
      const args = call.function?.arguments;
      if (typeof args === "string" && args.length > 0) {
        yield args;
      }
    }
  }
}
