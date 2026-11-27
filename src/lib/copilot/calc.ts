/**
 * Safe arithmetic evaluator for the copilot (no eval). Supports + - * / % ^, parentheses,
 * unary minus, and round(x[, digits]), min(...), max(...), abs(x), sqrt(x).
 */
type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "id"; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9._]/.test(s[j])) j++;
      const v = Number(s.slice(i, j).replace(/_/g, ""));
      if (!Number.isFinite(v)) throw new Error(`Bad number near "${s.slice(i, j)}"`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^(),".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

export function calculate(expr: string): number {
  if (expr.length > 500) throw new Error("Expression too long");
  const toks = lex(expr); // numbers must not contain thousands separators (commas separate function arguments)
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p++];
    if (!t || (v && t.v !== v)) throw new Error(`Expected "${v ?? "value"}"`);
    return t;
  };
  const FN: Record<string, (a: number[]) => number> = {
    round: (a) => { const d = a[1] ?? 0; const f = 10 ** d; return Math.round(a[0] * f) / f; },
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
    abs: (a) => Math.abs(a[0]),
    sqrt: (a) => Math.sqrt(a[0]),
  };
  function primary(): number {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "op" && t.v === "(") { p++; const v = expr0(); eat(")"); return v; }
    if (t.t === "op" && t.v === "-") { p++; return -power(); }
    if (t.t === "op" && t.v === "+") { p++; return power(); }
    if (t.t === "id") {
      p++;
      const f = FN[t.v];
      if (!f) throw new Error(`Unknown function ${t.v}`);
      eat("(");
      const args = [expr0()];
      while (peek()?.v === ",") { p++; args.push(expr0()); }
      eat(")");
      return f(args);
    }
    throw new Error(`Unexpected "${t.v}"`);
  }
  function power(): number {
    const b = primary();
    if (peek()?.v === "^") { p++; return b ** power(); }
    return b;
  }
  function term(): number {
    let v = power();
    while (peek() && ["*", "/", "%"].includes(String(peek()!.v))) {
      const op = eat().v;
      const r = power();
      if ((op === "/" || op === "%") && r === 0) throw new Error("Division by zero");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function expr0(): number {
    let v = term();
    while (peek() && ["+", "-"].includes(String(peek()!.v))) {
      const op = eat().v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = expr0();
  if (p !== toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  if (!Number.isFinite(v)) throw new Error("Result is not a finite number");
  return v;
}
