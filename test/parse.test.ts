import { describe, it, expect } from "vitest";
import { z } from "zod";
import { streamParse, parsePartial } from "../src/parse.js";

function chunkedStream(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}

function charByChar(s: string): AsyncIterable<string> {
  return chunkedStream(Array.from(s));
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

const Product = z.object({
  name: z.string(),
  price: z.number(),
  tags: z.array(z.string()),
});

describe("parsePartial — single-shot repair + validate", () => {
  it("returns typed partial from complete JSON", () => {
    const v = parsePartial(
      '{"name":"acme","price":19.99,"tags":["a","b"]}',
      Product,
    );
    expect(v).toEqual({ name: "acme", price: 19.99, tags: ["a", "b"] });
  });

  it("returns partial for truncated string value", () => {
    const v = parsePartial('{"name":"ac', Product);
    expect(v).toEqual({ name: "ac" });
  });

  it("returns partial for truncated array", () => {
    const v = parsePartial('{"name":"a","tags":["x","y', Product);
    expect(v).toEqual({ name: "a", tags: ["x", "y"] });
  });

  it("drops trailing incomplete number so later emissions stay stable", () => {
    const v = parsePartial('{"name":"a","price":49', Product);
    expect(v).toEqual({ name: "a" });
  });
});

describe("streamParse — progressive yields", () => {
  it("yields progressively richer partials", async () => {
    const src = chunkedStream([
      '{"name":"ac',
      'me","price"',
      ":19.99,",
      '"tags":["elec',
      'tron","gadget"]}',
    ]);
    const results = await collect(streamParse(src, Product));
    // We expect final result fully populated and at least one intermediate.
    const final = results[results.length - 1];
    expect(final).toEqual({
      name: "acme",
      price: 19.99,
      tags: ["electron", "gadget"],
    });
    expect(results.length).toBeGreaterThan(1);
    const first = results[0]!;
    expect(first).toMatchObject({ name: expect.any(String) });
  });

  it("handles char-by-char stream", async () => {
    const src = charByChar('{"name":"x","price":1,"tags":["a"]}');
    const results = await collect(streamParse(src, Product));
    expect(results[results.length - 1]).toEqual({
      name: "x",
      price: 1,
      tags: ["a"],
    });
  });

  it("deduplicates no-op chunks (whitespace that doesn't change the repaired JSON)", async () => {
    const src = chunkedStream([
      '{"name":"a","price":1,"tags":[]}',
      "   ",
      " \n ",
    ]);
    const results = await collect(streamParse(src, Product));
    // First yield is the full object; subsequent whitespace must not yield again.
    expect(results.length).toBe(1);
    expect(results[0]).toEqual({ name: "a", price: 1, tags: [] });
  });

  it("supports transformChunk for SSE-style frames", async () => {
    const src = chunkedStream([
      'data: {"name":"a"}\n\n',
      'data: [DONE]\n\n',
    ]);
    const results = await collect(
      streamParse(src, Product, {
        transformChunk: (chunk) => {
          const m = chunk.match(/^data:\s*(.*?)\s*$/m);
          if (!m) return null;
          if (m[1] === "[DONE]") return null;
          return m[1] ?? null;
        },
      }),
    );
    expect(results[results.length - 1]).toEqual({ name: "a" });
  });
});

describe("streamParse — schema typing", () => {
  it("nested objects stream correctly", async () => {
    const User = z.object({
      id: z.string(),
      profile: z.object({
        name: z.string(),
        email: z.string(),
      }),
    });
    const src = charByChar('{"id":"u1","profile":{"name":"joe","email":"x@y"}}');
    const results = await collect(streamParse(src, User));
    expect(results[results.length - 1]).toEqual({
      id: "u1",
      profile: { name: "joe", email: "x@y" },
    });
  });

  it("array of objects streams correctly", async () => {
    const Items = z.object({
      items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    });
    const src = charByChar(
      '{"items":[{"sku":"a","qty":1},{"sku":"b","qty":2}]}',
    );
    const results = await collect(streamParse(src, Items));
    const final = results[results.length - 1];
    expect(final).toEqual({
      items: [
        { sku: "a", qty: 1 },
        { sku: "b", qty: 2 },
      ],
    });
  });
});
