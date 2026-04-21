import { z } from "zod";
import { repairPartialJson } from "./repair.js";

export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface StreamParseOptions {
  /**
   * Called on each incoming raw chunk before buffering. Useful to unwrap
   * SSE frames that carry non-JSON scaffolding (e.g. OpenAI's
   * `data: {...}\n\n`). Return `null` to skip the chunk.
   *
   * If omitted, chunks are appended to the buffer verbatim.
   */
  transformChunk?: (chunk: string) => string | null;
}

/**
 * Parse a stream of text chunks as a growing JSON value, yielding typed
 * partial results validated against the given Zod schema.
 *
 * The yielded value is the deep-partial of the schema's inferred type.
 * Each yield strictly differs from the previous one (by repaired JSON
 * string), so the consumer can treat it as the latest known state.
 */
export async function* streamParse<S extends z.ZodTypeAny>(
  source: AsyncIterable<string>,
  schema: S,
  options: StreamParseOptions = {},
): AsyncGenerator<DeepPartial<z.infer<S>>, void, void> {
  let buffer = "";
  let lastJson = "";
  const partialSchema = getPartialSchema(schema);

  for await (const chunk of source) {
    const transformed = options.transformChunk
      ? options.transformChunk(chunk)
      : chunk;
    if (transformed === null) continue;
    buffer += transformed;

    const repaired = repairPartialJson(buffer);
    if (repaired === lastJson) continue;
    lastJson = repaired;

    let parsed: unknown;
    try {
      parsed = JSON.parse(repaired);
    } catch {
      continue;
    }

    const result = partialSchema.safeParse(parsed);
    if (result.success) {
      yield result.data as DeepPartial<z.infer<S>>;
    }
  }
}

/**
 * Parse a complete JSON-in-string buffer (non-streaming). Equivalent to
 * streamParse over a single-chunk source. Returns the latest validated
 * partial, or throws on fundamentally broken input.
 */
export function parsePartial<S extends z.ZodTypeAny>(
  input: string,
  schema: S,
): DeepPartial<z.infer<S>> {
  const partialSchema = getPartialSchema(schema);
  const repaired = repairPartialJson(input);
  const value = JSON.parse(repaired) as unknown;
  const result = partialSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `partial-zod.parsePartial: schema validation failed: ${result.error.message}`,
    );
  }
  return result.data as DeepPartial<z.infer<S>>;
}

function getPartialSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const anySchema = schema as unknown as {
    deepPartial?: () => z.ZodTypeAny;
    partial?: () => z.ZodTypeAny;
  };
  if (typeof anySchema.deepPartial === "function") {
    return anySchema.deepPartial();
  }
  if (typeof anySchema.partial === "function") {
    return anySchema.partial();
  }
  return schema;
}
