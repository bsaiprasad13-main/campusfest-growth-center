/**
 * Copilot agent loop (provider-neutral function calling).
 * The model never sees raw tables: it asks for numbers through tools, which run the same
 * metrics engine as the dashboard on the currently stored data.
 */
import { loadState, type LoadedState } from "../state";
import { configuredProviders, type NMsg, type Provider } from "./providers";
import { runTool, TOOL_DECLARATIONS, type Proposal, type ToolCtx } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface TraceStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface AgentResult {
  answer: string;
  trace: TraceStep[];
  proposals: Proposal[];
  model?: string;
  tokens?: number; // total tokens used across all model calls for this answer
}

function systemPrompt(asOf: string, phase: string, today: string) {
  return `You are the Growth Analyst copilot for CampusFest attendee growth (fictional 2-day fest, 12–13 Apr 2025; records 15 Jan–20 Apr 2025, plus the team's tasks, plans and rules). App snapshot date: ${asOf} (end of day IST, phase: ${phase}). Today: ${today}. North star: unique verified external attendees.

Rules:
1. Every number, campaign, owner and rate must come from a tool result in this conversation; never mention a campaign or figure the tools did not return, and never compute rates yourself (use tool values or calculate). Data can change at any time: re-fetch, never rely on memory or general knowledge.
2. Use calculate for any arithmetic beyond reading a value; show the formula.
3. Label **Evidence** (data, metric name), **Assumption** (not in data: estimates, causes) and **Recommendation**.
4. If the data cannot answer (e.g. college, city, demographics, revenue, ticket price, satisfaction, capacity, or WHY something happened, such as creative quality), say so in the first sentence ("The data shows what happened, not why"), name what's missing, offer the closest answerable question. Unsure? get_data_dictionary. Flag thin evidence (small counts, correlation, pre-event).
5. Scale/change/stop: report the official decision and reasons from get_campaigns (team rules); add your own view only if clearly labelled as yours.
6. Before the event there is no attendance; projections are estimates. Budget moves: simulate_budget, labelled a model estimate.
7. When asked to create a task or change a campaign (or the user agrees), call propose_task / propose_campaign_update. It is only a draft shown below your answer for the user to Confirm; never say it was created.
8. Resolve follow-ups from the conversation.
9. Style: direct answer first, then short bullets or a small table. Money as ₹ with Indian grouping, no decimals (₹81, ₹2,74,000); percentages with one decimal; campaign names, not IDs. Concise. Call tools only via function calling.`;
}

function summarize(result: unknown): string {
  const s = JSON.stringify(result);
  if (!s) return "";
  if (typeof result === "object" && result && "error" in result) return `error: ${(result as { error: string }).error}`;
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAgent(history: ChatTurn[], message: string, asOf: string | undefined): Promise<AgentResult> {
  const providers = configuredProviders();
  if (!providers.length) throw new Error("NO_KEY");
  const candidates: { p: Provider; model: string }[] = providers.flatMap((p) => p.models.map((model) => ({ p, model })));
  let ci = 0;
  const failures: string[] = [];
  // Whole answer must finish inside the host's request limit (Vercel: 60 s).
  const deadline = Date.now() + Number(process.env.COPILOT_DEADLINE_MS ?? 55000);
  const PER_CALL_MS = 25000;

  const cache = new Map<string, Promise<LoadedState>>();
  const first = await loadState(asOf);
  const defaultAsOf = first.snapshot.as_of;
  cache.set(defaultAsOf, Promise.resolve(first));
  const ctx: ToolCtx = {
    defaultAsOf,
    proposals: [],
    load: (d?: string) => {
      const k = d ?? defaultAsOf;
      if (!cache.has(k)) cache.set(k, loadState(k));
      return cache.get(k)!;
    },
  };
  const system = systemPrompt(defaultAsOf, first.snapshot.event.phase, new Date().toISOString().slice(0, 10));
  // Keep the last 4 exchanges; trim long earlier answers to save tokens (free tiers limit tokens per minute).
  const msgs: NMsg[] = [
    ...history.slice(-8).map((t): NMsg => (t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text.length > 1500 ? t.text.slice(0, 1500) + " …" : t.text })),
    { role: "user", text: message },
  ];
  const trace: TraceStep[] = [];
  let waits = 0;

  async function callModel(requireTool: boolean) {
    while (ci < candidates.length) {
      const { p, model } = candidates[ci];
      // Gemini rejects tool-call history it did not produce itself (missing thought signatures),
      // so never switch INTO Gemini in the middle of a multi-step answer.
      const foreignCalls = msgs.some((m) => m.role === "assistant" && m.toolCalls?.length && m.raw?.provider !== p.id);
      if (p.kind === "gemini" && foreignCalls) { ci++; continue; }
      const remaining = deadline - Date.now();
      if (remaining < 3000) throw new Error("DEADLINE");
      let r;
      try {
        r = await p.call(model, system, msgs, TOOL_DECLARATIONS, { signal: AbortSignal.timeout(Math.min(PER_CALL_MS, remaining)), requireTool });
      } catch {
        failures.push(`${p.id}/${model}: timed out`);
        ci++;
        continue;
      }
      if (r.ok) return { ...r, provider: p.id, model };
      // A short per-minute limit: waiting a few seconds beats falling back to a weaker model.
      if (r.status === 429 && r.retryAfterMs != null && r.retryAfterMs <= 15000 && waits < 3 && deadline - Date.now() > r.retryAfterMs + 8000) {
        waits++;
        await sleep(r.retryAfterMs + 250);
        continue;
      }
      const why =
        r.status === 429 ? (/per day|daily|tokens per day|TPD|RPD/i.test(r.message) ? "daily free quota used up" : "rate or quota limit")
        : r.status === 404 ? "not available to this key"
        : r.status >= 500 ? "overloaded"
        : `error ${r.status}: ${r.message.slice(0, 160)}`;
      failures.push(`${p.id}/${model}: ${why}`);
      // Busy, out of quota, unknown model or a model that cannot handle this request: try the next one.
      ci++;
      await sleep(250);
    }
    const allQuota = failures.length > 0 && failures.every((f) => /quota|limit|not available/.test(f));
    throw new Error(
      allQuota
        ? `The AI service's quota for the configured keys is used up (${failures.join("; ")}). The dashboard and all other features still work. Try again after the limit resets, or add billing / another key.`
        : `The AI service could not answer right now (${failures.join("; ")}). Please try again in a minute.`,
    );
  }

  let usedModel: string | undefined;
  let tokens = 0;
  for (let round = 0; round < 10; round++) {
    let r;
    try {
      r = await callModel(round === 0); // first step must look up data: no answer from memory alone
    } catch (e) {
      if (e instanceof Error && e.message === "DEADLINE") {
        return {
          answer: `I ran out of time before finishing (the AI service is slow right now). I completed ${trace.length} data look-up${trace.length === 1 ? "" : "s"}, listed below. Please ask again, or narrow the question (one campaign or one date).`,
          trace,
          proposals: ctx.proposals,
          model: usedModel,
          tokens,
        };
      }
      throw e;
    }
    usedModel = `${r.provider}/${r.model}`;
    tokens += r.tokens ?? 0;
    msgs.push({ role: "assistant", text: r.text, toolCalls: r.toolCalls, raw: r.raw ? { provider: r.provider, data: r.raw } : undefined });
    if (!r.toolCalls.length) {
      return { answer: r.text.trim() || "(no answer)", trace, proposals: ctx.proposals, model: usedModel, tokens };
    }
    for (const c of r.toolCalls) {
      const result = await runTool(c.name, c.args, ctx);
      trace.push({ tool: c.name, args: c.args, summary: summarize(result) });
      msgs.push({ role: "tool", toolCallId: c.id, name: c.name, result });
    }
  }
  return { answer: "I needed too many steps to answer this. Please narrow the question (for example, one campaign or one date).", trace, proposals: ctx.proposals, model: usedModel, tokens };
}
