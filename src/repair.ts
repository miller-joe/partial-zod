/**
 * Streaming-tuned JSON repair: given a truncated JSON string produced by an
 * LLM stream, produce the "best-effort" valid JSON representing what has
 * been received so far.
 *
 * The only failure modes this function must handle are the ones produced by
 * truncating a valid JSON string at an arbitrary position. It is not a
 * general JSON repair library (use `jsonrepair` for that); it assumes the
 * LLM emits valid JSON when given enough time.
 *
 * Conservative choices kept partial emissions stable under the expected
 * consumer model (re-repair the buffer on every chunk, yield on change):
 *  - Strings in progress ARE recovered (close with synthetic `"`).
 *  - Numbers in progress are dropped until a terminator arrives, to avoid
 *    emitting `49` when the next char might be `3` (making it `493`).
 *  - Keywords in progress (`tru`, `fa`, `nu`) are dropped.
 *  - Incomplete keys (object keys still streaming) are dropped.
 *  - Escape sequences at the truncation boundary are rolled back.
 */

type ContextKind = "object" | "array";

interface Context {
  kind: ContextKind;
  /** Output length BEFORE pushing the opening `{`/`[` — used to detect containers with no complete members. */
  entryLength: number;
  /** Output length after the last complete child value (initialized to entryLength + 1). */
  lastSafeEnd: number;
  /** Parent's `lastSafeEnd` at the moment this child was entered. Used to drop the child when it turns out empty at EOF. */
  parentSafeEnd: number;
}

/**
 * Repair a (possibly truncated) JSON string into a valid JSON string.
 *
 * Returns `"null"` when the input is empty, only whitespace, or too
 * incomplete to recover anything.
 */
export function repairPartialJson(input: string): string {
  const n = input.length;
  let i = 0;
  while (i < n && isWs(input[i])) i++;
  if (i >= n) return "null";

  const topFirst = input[i];

  // Top-level scalar (string/number/keyword)
  if (topFirst !== "{" && topFirst !== "[") {
    if (topFirst === '"') {
      const r = consumeStringRecover(input, i);
      return r.text;
    }
    // Numbers and keywords at top level: require a terminator to be safe.
    const val = consumeNumber(input, i);
    if (val.kind === "scalar") {
      return input.slice(i, val.end);
    }
    const kw = consumeKeyword(input, i);
    if (kw.kind === "scalar") {
      return input.slice(i, kw.end);
    }
    return "null";
  }

  const out: string[] = [];
  const ctxStack: Context[] = [];

  const entryLength = out.length;
  out.push(topFirst);
  ctxStack.push({
    kind: topFirst === "{" ? "object" : "array",
    entryLength,
    lastSafeEnd: out.length,
    parentSafeEnd: 0,
  });
  i++;

  scan: while (i < n && ctxStack.length > 0) {
    const ctx = ctxStack[ctxStack.length - 1]!;
    while (i < n && isWs(input[i])) {
      out.push(input[i]!);
      i++;
    }
    if (i >= n) break;

    const c = input[i]!;

    if (
      (ctx.kind === "object" && c === "}") ||
      (ctx.kind === "array" && c === "]")
    ) {
      out.push(c);
      i++;
      ctxStack.pop();
      if (ctxStack.length > 0) {
        ctxStack[ctxStack.length - 1]!.lastSafeEnd = out.length;
      }
      continue;
    }

    if (c === ",") {
      out.push(c);
      i++;
      ctx.lastSafeEnd = out.length;
      continue;
    }

    if (ctx.kind === "object") {
      const kvStart = out.length;
      // Key must be a string
      if (c !== '"') break scan;
      const keyResult = consumeStringRaw(input, i);
      if (!keyResult.complete) break scan;
      out.push(input.slice(i, keyResult.end));
      i = keyResult.end;
      while (i < n && isWs(input[i])) {
        out.push(input[i]!);
        i++;
      }
      if (i >= n || input[i] !== ":") {
        rollbackTo(out, kvStart);
        break scan;
      }
      out.push(":");
      i++;
      while (i < n && isWs(input[i])) {
        out.push(input[i]!);
        i++;
      }
      if (i >= n) {
        rollbackTo(out, kvStart);
        break scan;
      }
      const res = consumeMemberValue(input, i);
      if (res.kind === "incomplete") {
        rollbackTo(out, kvStart);
        break scan;
      }
      if (res.kind === "enter") {
        const childEntry = out.length;
        out.push(input[i]!);
        i++;
        ctxStack.push({
          kind: res.containerKind,
          entryLength: childEntry,
          lastSafeEnd: out.length,
          parentSafeEnd: ctx.lastSafeEnd,
        });
        continue;
      }
      out.push(res.text);
      i = res.end;
      ctx.lastSafeEnd = out.length;
      continue;
    }

    // Array
    const elStart = out.length;
    const res = consumeMemberValue(input, i);
    if (res.kind === "incomplete") {
      rollbackTo(out, elStart);
      break scan;
    }
    if (res.kind === "enter") {
      const childEntry = out.length;
      out.push(input[i]!);
      i++;
      ctxStack.push({
        kind: res.containerKind,
        entryLength: childEntry,
        lastSafeEnd: out.length,
        parentSafeEnd: ctx.lastSafeEnd,
      });
      continue;
    }
    out.push(res.text);
    i = res.end;
    ctx.lastSafeEnd = out.length;
  }

  while (ctxStack.length > 0) {
    const ctx = ctxStack.pop()!;
    const isEmpty = ctx.lastSafeEnd <= ctx.entryLength + 1;
    const hasParent = ctxStack.length > 0;
    if (isEmpty && hasParent) {
      // Drop the partial child entirely. Roll the parent back to where it
      // was safe before this child (strips the leading comma, object key,
      // and colon that led into this child).
      rollbackTo(out, ctx.parentSafeEnd);
      // Do not update the parent's lastSafeEnd — it's already at parentSafeEnd.
    } else {
      rollbackTo(out, ctx.lastSafeEnd);
      stripTrailingCommaAndWs(out);
      out.push(ctx.kind === "object" ? "}" : "]");
      if (hasParent) {
        ctxStack[ctxStack.length - 1]!.lastSafeEnd = out.length;
      }
    }
  }

  return out.join("");
}

function rollbackTo(out: string[], length: number): void {
  while (out.length > length) out.pop();
}

function stripTrailingCommaAndWs(out: string[]): void {
  while (out.length > 0 && isWs(out[out.length - 1]!)) out.pop();
  if (out.length > 0 && out[out.length - 1] === ",") out.pop();
  while (out.length > 0 && isWs(out[out.length - 1]!)) out.pop();
}

function isWs(c: string | undefined): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

interface RawStringResult {
  /** Position of the character after the closing quote. */
  end: number;
  complete: boolean;
}

/**
 * Consume a JSON string starting at `input[start]` (which must be `"`),
 * without synthesizing recovery. Used for object keys where partial recovery
 * is never desired (we drop the whole pair).
 */
function consumeStringRaw(input: string, start: number): RawStringResult {
  const n = input.length;
  let i = start + 1;
  while (i < n) {
    const c = input[i]!;
    if (c === "\\") {
      if (i + 1 >= n) return { end: i, complete: false };
      i += 2;
      continue;
    }
    if (c === '"') return { end: i + 1, complete: true };
    i++;
  }
  return { end: i, complete: false };
}

/**
 * Consume a JSON string with recovery: if the string is truncated, back off
 * any dangling escape and append a synthetic closing quote. The result is
 * always a valid JSON string literal.
 */
function consumeStringRecover(
  input: string,
  start: number,
): { end: number; complete: boolean; text: string } {
  const n = input.length;
  let i = start + 1;
  let lastSafe = i;
  while (i < n) {
    const c = input[i]!;
    if (c === "\\") {
      if (i + 1 >= n) {
        // Dangling escape — back off to just before the backslash.
        return {
          end: n,
          complete: false,
          text: input.slice(start, lastSafe) + '"',
        };
      }
      // Validate unicode escape has all 4 hex digits
      if (input[i + 1] === "u") {
        // Need 4 hex digits after \u
        if (i + 2 + 4 > n) {
          // Truncated unicode escape — back off to before \u
          return {
            end: n,
            complete: false,
            text: input.slice(start, lastSafe) + '"',
          };
        }
      }
      i += 2;
      lastSafe = i;
      continue;
    }
    if (c === '"') {
      return {
        end: i + 1,
        complete: true,
        text: input.slice(start, i + 1),
      };
    }
    i++;
    lastSafe = i;
  }
  // EOF without closing quote
  return {
    end: n,
    complete: false,
    text: input.slice(start, lastSafe) + '"',
  };
}

type MemberResult =
  | { kind: "scalar"; end: number; text: string }
  | { kind: "enter"; containerKind: ContextKind }
  | { kind: "incomplete" };

/**
 * Inspect the value at `input[start]` for use as an object member value or
 * an array element. Strings are recovered (always produce a scalar);
 * numbers and keywords require terminators (else incomplete); objects and
 * arrays return enter.
 */
function consumeMemberValue(input: string, start: number): MemberResult {
  const c = input[start];
  if (c === undefined) return { kind: "incomplete" };
  if (c === "{") return { kind: "enter", containerKind: "object" };
  if (c === "[") return { kind: "enter", containerKind: "array" };
  if (c === '"') {
    const s = consumeStringRecover(input, start);
    return { kind: "scalar", end: s.end, text: s.text };
  }
  if (c === "t" || c === "f" || c === "n") {
    const kw = consumeKeyword(input, start);
    return kw.kind === "scalar"
      ? { kind: "scalar", end: kw.end, text: input.slice(start, kw.end) }
      : { kind: "incomplete" };
  }
  if (c === "-" || (c >= "0" && c <= "9")) {
    const num = consumeNumber(input, start);
    return num.kind === "scalar"
      ? { kind: "scalar", end: num.end, text: input.slice(start, num.end) }
      : { kind: "incomplete" };
  }
  return { kind: "incomplete" };
}

type TerminatorResult = { kind: "scalar"; end: number } | { kind: "incomplete" };

function consumeKeyword(input: string, start: number): TerminatorResult {
  const c = input[start];
  const kw = c === "t" ? "true" : c === "f" ? "false" : c === "n" ? "null" : null;
  if (!kw) return { kind: "incomplete" };
  const end = start + kw.length;
  if (input.slice(start, end) === kw) return { kind: "scalar", end };
  return { kind: "incomplete" };
}

function consumeNumber(input: string, start: number): TerminatorResult {
  const n = input.length;
  let i = start;
  if (input[i] === "-") i++;
  const intStart = i;
  if (input[i] === "0") {
    i++;
  } else {
    while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
  }
  if (i === intStart) return { kind: "incomplete" };

  let sawFraction = false;
  let sawExp = false;
  let fracStart = -1;
  let expStart = -1;

  if (input[i] === ".") {
    sawFraction = true;
    i++;
    fracStart = i;
    while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
  }
  if (input[i] === "e" || input[i] === "E") {
    sawExp = true;
    i++;
    expStart = i;
    if (input[i] === "+" || input[i] === "-") i++;
    while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
  }

  // At EOF the number might still be receiving digits, so we must see a
  // terminator (comma, brace/bracket, whitespace, EOF-of-top-level) before
  // committing. For embedded use we are strict: hitting raw EOF = incomplete.
  if (i >= n) {
    return { kind: "incomplete" };
  }

  // Validate mid-number truncation edge cases even when not at EOF.
  if (input[i - 1] === "-" || input[i - 1] === "+") {
    return { kind: "incomplete" };
  }
  if (sawFraction && fracStart === i) return { kind: "incomplete" };
  if (sawExp && expStart === i) return { kind: "incomplete" };

  return { kind: "scalar", end: i };
}
