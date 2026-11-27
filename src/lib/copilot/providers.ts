/**
 * LLM provider adapters. The agent keeps a provider-neutral transcript; each adapter turns it
 * into its own wire format. Supported:
 *  - "openai" style chat completions (Groq by default; also works for OpenAI, OpenRouter, etc.)
 *  - Gemini (generateContent with function calling)
 */

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export type NMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; raw?: { provider: string; data: unknown } }
  | { role: "tool"; toolCallId: string; name: string; result: unknown };

export interface ToolDecl { name: string; description: string; parameters: Record<string, unknown> }

export type CallResult =
  | { ok: true; text: string; toolCalls: ToolCall[]; raw?: unknown; tokens?: number }
  | { ok: false; status: number; message: string; retryAfterMs?: number };

export interface CallOptions {
  signal: AbortSignal;
  requireTool: boolean; // force the model to call a tool (used on the first step so answers are always grounded)
}

export interface Provider {
  id: string; // "groq" | "gemini" | custom
  kind: "openai" | "gemini";
  models: string[];
  call(model: string, system: string, msgs: NMsg[], tools: ToolDecl[], opts: CallOptions): Promise<CallResult>;
}

// "585ms", "7.66s", "1m2.5s", or plain seconds → milliseconds
function parseDuration(s: string | null): number | undefined {
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let ms = 0;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) ms += Number(n) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[u as "ms"]!;
  return ms || undefined;
}

// Gemini-style schema (OBJECT/STRING…) → JSON Schema (object/string…)
function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) o[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
    return o;
  }
  return s;
}

// Optional scalar parameters also accept null: some models send null for "not given", and Groq
// rejects the whole response when a tool call does not match the schema.
function nullableOptionals(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(nullableOptionals);
  if (!schema || typeof schema !== "object") return schema;
  const o = { ...(schema as Record<string, unknown>) };
  if (o.properties && typeof o.properties === "object") {
    const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    o.properties = Object.fromEntries(
      Object.entries(o.properties as Record<string, Record<string, unknown>>).map(([k, v]) => {
        const inner = nullableOptionals(v) as Record<string, unknown>;
        return [k, !req.has(k) && typeof inner.type === "string" && ["string", "number", "integer", "boolean"].includes(inner.type) ? { ...inner, type: [inner.type, "null"] } : inner];
      }),
    );
  }
  if (o.items) o.items = nullableOptionals(o.items);
  return o;
}

// Parse tool arguments and drop null/empty values, so tools see "not given" consistently.
function parseArgs(a: unknown): Record<string, unknown> {
  let o: unknown = a;
  if (typeof a === "string") {
    try { o = a.trim() ? JSON.parse(a) : {}; } catch { o = {}; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

// ---------------- OpenAI-compatible (Groq) ----------------

export function openAICompatible(id: string, baseUrl: string, apiKey: string, models: string[]): Provider {
  return {
    id,
    kind: "openai",
    models,
    async call(model, system, msgs, tools, { signal, requireTool }) {
      const messages: unknown[] = [{ role: "system", content: system }];
      for (const m of msgs) {
        if (m.role === "user") messages.push({ role: "user", content: m.text });
        else if (m.role === "assistant") {
          messages.push({
            role: "assistant",
            content: m.text ?? "",
            ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
          });
        } else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: JSON.stringify(m.result) });
      }
      const send = (toolChoice: string) =>
        fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: nullableOptionals(toJsonSchema(t.parameters)) } })),
            tool_choice: toolChoice,
            temperature: 0.2,
          }),
          signal,
        });
      let res = await send(requireTool ? "required" : "auto");
      let j = await res.json().catch(() => ({}));
      if (!res.ok && res.status === 400 && requireTool && /tool_choice/i.test(JSON.stringify(j))) {
        res = await send("auto");
        j = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        const retryAfterMs = parseDuration(res.headers.get("retry-after")) ?? parseDuration(res.headers.get("x-ratelimit-reset-tokens"));
        return { ok: false, status: res.status, message: j?.error?.message ?? JSON.stringify(j).slice(0, 300), retryAfterMs };
      }
      const msg = j.choices?.[0]?.message;
      if (!msg) return { ok: false, status: 502, message: "empty response" };
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: unknown } }, i: number) => ({
        id: c.id ?? `call_${i}`,
        name: c.function?.name,
        args: parseArgs(c.function?.arguments),
      }));
      return { ok: true, text: typeof msg.content === "string" ? msg.content : "", toolCalls, tokens: j.usage?.total_tokens };
    },
  };
}

// ---------------- Gemini ----------------

type GPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
type GContent = { role: "user" | "model"; parts: GPart[] };

export function gemini(apiKey: string, models: string[]): Provider {
  return {
    id: "gemini",
    kind: "gemini",
    models,
    async call(model, system, msgs, tools, { signal, requireTool }) {
      const contents: GContent[] = [];
      // Gemini rejects function calls it did not produce itself (no thought signature). Steps taken by
      // another model are replayed as plain text, so Gemini can take over in the middle of an answer.
      const foreignCallIds = new Set<string>();
      const pushUserText = (text: string) => {
        const last = contents[contents.length - 1];
        if (last && last.role === "user" && last.parts.every((p) => p.text != null)) last.parts.push({ text });
        else contents.push({ role: "user", parts: [{ text }] });
      };
      for (const m of msgs) {
        if (m.role === "user") pushUserText(m.text);
        else if (m.role === "assistant") {
          if (m.raw?.provider === "gemini") contents.push({ role: "model", parts: m.raw.data as GPart[] });
          else {
            const calls = (m.toolCalls ?? []).map((c) => {
              foreignCallIds.add(c.id);
              return `[I called the tool ${c.name} with ${JSON.stringify(c.args)}]`;
            });
            const text = [m.text, ...calls].filter(Boolean).join("\n");
            contents.push({ role: "model", parts: [{ text: text || "…" }] });
          }
        } else if (foreignCallIds.has(m.toolCallId)) {
          pushUserText(`[Result of ${m.name}]: ${JSON.stringify(m.result)}`);
        } else {
          const part: GPart = { functionResponse: { name: m.name, response: { result: m.result } } };
          const last = contents[contents.length - 1];
          if (last && last.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
          else contents.push({ role: "user", parts: [part] });
        }
      }
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        ...(requireTool ? { toolConfig: { functionCallingConfig: { mode: "ANY" } } } : {}),
      };
      // Gemini 3 models think before answering; low thinking is enough for tool-driven analysis and much faster.
      if (model.startsWith("gemini-3")) body.generationConfig = { thinkingConfig: { thinkingLevel: "low" } };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, message: j?.error?.message ?? JSON.stringify(j).slice(0, 300) };
      const parts: GPart[] | undefined = j.candidates?.[0]?.content?.parts;
      if (!parts?.length) return { ok: false, status: 502, message: `no answer (${j.candidates?.[0]?.finishReason ?? j.promptFeedback?.blockReason ?? "empty"})` };
      const toolCalls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: `g_${Date.now()}_${i}`, name: p.functionCall!.name, args: parseArgs(p.functionCall!.args ?? {}) }));
      return { ok: true, text: parts.map((p) => p.text ?? "").join(""), toolCalls, raw: parts, tokens: j.usageMetadata?.totalTokenCount };
    },
  };
}

// ---------------- configuration from environment ----------------

const list = (s: string | undefined, d: string) => (s ?? d).split(",").map((x) => x.trim()).filter(Boolean);

export function configuredProviders(): Provider[] {
  const all: Record<string, Provider> = {};
  if (process.env.GROQ_API_KEY) {
    all.groq = openAICompatible("groq", process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1", process.env.GROQ_API_KEY, list(process.env.GROQ_MODELS, "openai/gpt-oss-120b,openai/gpt-oss-20b"));
  }
  // Optional extra provider: any OpenAI-compatible host (BACKUP_BASE_URL + BACKUP_MODELS).
  if (process.env.BACKUP_API_KEY) {
    all.backup = openAICompatible("backup", process.env.BACKUP_BASE_URL ?? "https://api.cerebras.ai/v1", process.env.BACKUP_API_KEY, list(process.env.BACKUP_MODELS, "gpt-oss-120b"));
  }
  if (process.env.GEMINI_API_KEY) {
    all.gemini = gemini(process.env.GEMINI_API_KEY, list(process.env.GEMINI_MODELS, "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"));
  }
  // LLM_PROVIDERS sets the order; any configured provider it leaves out is still tried, last.
  const order = list(process.env.LLM_PROVIDERS, "groq,backup,gemini");
  for (const id of ["groq", "backup", "gemini"]) if (!order.includes(id)) order.push(id);
  return order.map((p) => all[p]).filter(Boolean);
}
