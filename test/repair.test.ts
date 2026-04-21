import { describe, it, expect } from "vitest";
import { repairPartialJson } from "../src/repair.js";

function parse(s: string): unknown {
  return JSON.parse(repairPartialJson(s));
}

describe("repairPartialJson — complete inputs pass through", () => {
  it("empty object", () => {
    expect(parse("{}")).toEqual({});
  });
  it("empty array", () => {
    expect(parse("[]")).toEqual([]);
  });
  it("flat object", () => {
    expect(parse('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });
  it("nested object", () => {
    expect(parse('{"a":{"b":[1,2,3]}}')).toEqual({ a: { b: [1, 2, 3] } });
  });
});

describe("repairPartialJson — incomplete strings", () => {
  it("mid-string in value", () => {
    expect(parse('{"name":"ac')).toEqual({ name: "ac" });
  });
  it("mid-string in array", () => {
    expect(parse('{"tags":["elec')).toEqual({ tags: ["elec"] });
  });
  it("escape sequence truncated", () => {
    // `"ab\` — the backslash has no following char; roll back inside the
    // value, then close.
    expect(parse('{"s":"ab\\')).toEqual({ s: "ab" });
  });
  it("empty string", () => {
    expect(parse('{"s":"')).toEqual({ s: "" });
  });
});

describe("repairPartialJson — incomplete containers", () => {
  it("open object with pending key", () => {
    expect(parse('{"a"')).toEqual({});
  });
  it("open object with colon but no value", () => {
    expect(parse('{"a":')).toEqual({});
  });
  it("open object with one complete pair then partial", () => {
    expect(parse('{"a":1,"b":')).toEqual({ a: 1 });
  });
  it("open object with trailing comma", () => {
    expect(parse('{"a":1,')).toEqual({ a: 1 });
  });
  it("open array with trailing comma", () => {
    expect(parse("[1,2,")).toEqual([1, 2]);
  });
  it("deeply nested open containers", () => {
    expect(parse('{"a":{"b":[1,2')).toEqual({ a: { b: [1] } });
  });
});

describe("repairPartialJson — incomplete numbers", () => {
  it("bare minus is dropped", () => {
    expect(parse('{"n":-')).toEqual({});
  });
  it("trailing decimal point is dropped", () => {
    expect(parse('{"n":49.')).toEqual({});
  });
  it("complete number followed by nothing is dropped (stream may continue)", () => {
    // This is the conservative choice: at EOF a number could still be
    // receiving digits, so we roll back to keep later partials stable.
    expect(parse('{"n":49')).toEqual({});
  });
  it("number followed by comma is kept", () => {
    expect(parse('{"n":49,"m":')).toEqual({ n: 49 });
  });
  it("number followed by closing brace is kept", () => {
    expect(parse('{"n":49}')).toEqual({ n: 49 });
  });
  it("exponent incomplete is dropped", () => {
    expect(parse('{"n":1e')).toEqual({});
    expect(parse('{"n":1e+')).toEqual({});
  });
  it("negative number complete", () => {
    expect(parse('{"n":-49,')).toEqual({ n: -49 });
  });
});

describe("repairPartialJson — keywords", () => {
  it("complete true / false / null", () => {
    expect(parse('{"a":true,"b":false,"c":null}')).toEqual({
      a: true,
      b: false,
      c: null,
    });
  });
  it("truncated keyword drops the pair", () => {
    expect(parse('{"a":tru')).toEqual({});
    expect(parse('{"a":fa')).toEqual({});
    expect(parse('{"a":nu')).toEqual({});
  });
});

describe("repairPartialJson — arrays", () => {
  it("array of strings, last truncated", () => {
    expect(parse('["a","b","c')).toEqual(["a", "b", "c"]);
  });
  it("array of objects, last open", () => {
    expect(parse('[{"x":1},{"x":2')).toEqual([{ x: 1 }]);
  });
  it("empty array closed", () => {
    expect(parse("[")).toEqual([]);
  });
});

describe("repairPartialJson — edge cases", () => {
  it("whitespace only", () => {
    expect(parse("   ")).toEqual(null);
  });
  it("empty input", () => {
    expect(parse("")).toEqual(null);
  });
  it("single open brace", () => {
    expect(parse("{")).toEqual({});
  });
  it("escaped quote inside string", () => {
    expect(parse('{"s":"a\\"b"}')).toEqual({ s: 'a"b' });
  });
  it("preserves unicode in string", () => {
    expect(parse('{"s":"héllo')).toEqual({ s: "héllo" });
  });
});
