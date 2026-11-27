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

/** Thrown when the AI service cannot answer. `retryAfterS` is set when waiting briefly should fix it. */
export class CopilotUnavailable extends Error {
  constructor(message: string, public detail: string, public retryAfterS: number | null) {
    super(message);
  }
}

export interface AgentResult {
  answer: string;
  trace: TraceStep[];
  proposals: Proposal[];
  model?: string;
  tokens?: number; // total tokens used across all model calls for this answer
  fallbacks?: string[]; // models that failed before the one that answered
}

const wantsTask = (m: string) => /\b(task|to-?do|action item)s?\b/i.test(m) && /\b(create|draft|make|add|assign|log|set up|turn)\b/i.test(m);

function systemPrompt(asOf: string, phase: string, today: string) {
  return `You are the Growth Analyst copilot for CampusFest attendee growth. Data: the 2025 edition (fictional 2-day fest, 12–13 Apr 2025; records 15 Jan–20 Apr 2025), the team's tasks and rules, and the 2027 plan (five bets with weekly readings, thresholds, pace and forecast: get_plan_2027). App snapshot date: ${asOf} (end of day IST, 2025 phase: ${phase}). Today: ${today}. North star: unique verified external attendees.

Rules:
1. Every number, campaign, bet, owner and rate must come from a tool result in this conversation. Name only campaigns, channels and bets that a tool returned; never cite channels that are not in the data (e.g. email or influencers as campaigns). Never compute rates yourself (use tool values or calculate). Data can change at any time: re-fetch, never rely on memory or general knowledge.
2. Use calculate for any arithmetic beyond reading a value; show the formula.
3. Label **Evidence** (data, metric name), **Assumption** (not in data: estimates, causes) and **Recommendation**.
4. If the data cannot answer (e.g. college, city, demographics, revenue, ticket price, satisfaction, or WHY something happened, such as creative quality), say so in the first sentence ("The data shows what happened, not why"), name what's missing, offer the closest answerable question. Unsure? get_data_dictionary. Flag thin evidence (small counts, correlation, pre-event).
5. Scale/change/stop: for 2025 campaigns report the official decision and reasons from get_campaigns; for 2027 bets use get_plan_2027 labels. Add your own view only if clearly labelled as yours.
6. Phase: when the 2025 event is over, its campaigns cannot be changed any more: frame 2025 findings as lessons and link them to the 2027 bets (get_plan_2027), never "stop spending now". Before the event there is no attendance; projections are estimates. Budget moves: simulate_budget, labelled a model estimate. If get_plan_2027 says its readings are simulated, say so.
7. When asked to create a task or change a campaign (or the user agrees), call propose_task / propose_campaign_update. It is only a draft shown below your answer for the user to Confirm; never say it was created.
8. Resolve follow-ups from the conversation.
9. Style: direct answer first, then short bullets or a small table. "Came" or show rate = registrants who attended ÷ registrations. Money as ₹ with Indian grouping, no decimals (₹81, ₹2,74,000); percentages with one decimal; campaign names, not IDs. Concise. Call tools only via function calling.`;
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
  // Small models (e.g. gpt-oss-20b, *-lite) make more analysis slips, so every larger model is tried first.
  const isSmall = (m: string) => /(^|[-/])(\d{1,2}b|mini|lite|nano)(\b|-|$)/i.test(m);
  const all = providers.flatMap((p) => p.models.map((model) => ({ p, model })));
  const candidates: { p: Provider; model: string }[] = [...all.filter((c) => !isSmall(c.model)), ...all.filter((c) => isSmall(c.model))];
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
  let schemaRetries = 0;
  let shortestRetryMs: number | null = null;

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
      // The model produced a malformed tool call (provider-side schema check). It is random: ask the same model again.
      if (r.status === 400 && /tool call validation|tool_use_failed|failed to call a function|did not match schema/i.test(r.message) && schemaRetries < 2) {
        schemaRetries++;
        await sleep(400);
        continue;
      }
      if (r.status === 429 && r.retryAfterMs != null) shortestRetryMs = Math.min(shortestRetryMs ?? Infinity, r.retryAfterMs);
      // A short per-minute limit: waiting beats falling back to a weaker model.
      if (r.status === 429 && r.retryAfterMs != null && r.retryAfterMs <= 30000 && waits < 3 && deadline - Date.now() > r.retryAfterMs + 12000) {
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
    const detail = failures.join("; ");
    if (failures.some((f) => /daily free quota/.test(f)) && failures.every((f) => /quota|limit|not available/.test(f))) {
      throw new CopilotUnavailable("The free AI quota for today is used up. The dashboard, plan and tasks all still work; the copilot will answer again after the daily reset.", detail, null);
    }
    if (failures.every((f) => /rate or quota limit|overloaded|timed out/.test(f))) {
      const s = Math.min(30, Math.max(5, Math.ceil((shortestRetryMs ?? 15000) / 1000) + 1));
      throw new CopilotUnavailable("The free AI tier is busy (per-minute limit).", detail, s);
    }
    throw new CopilotUnavailable("The AI service could not answer this time. Please try again.", detail, 10);
  }

  let usedModel: string | undefined;
  let tokens = 0;
  let nudged = false;
  let requireNext = true; // first step must look up data: no answer from memory alone
  for (let round = 0; round < 10; round++) {
    let r;
    try {
      r = await callModel(requireNext);
      requireNext = false;
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
      // The user asked for a task but the model wrote it as text: ask once for the real draft (it needs a Confirm button).
      if (wantsTask(message) && ctx.proposals.length === 0 && !nudged) {
        nudged = true;
        requireNext = true;
        msgs.push({ role: "user", text: "Now call propose_task with that task (title, description, campaign or owner, due_date, priority). Do not write the task as text; reply with one short sentence after the call." });
        continue;
      }
      let answer = r.text.trim() || "(no answer)";
      // Honesty guard: never present the shipped example readings as real 2027 data.
      if (trace.some((t) => t.tool === "get_plan_2027") && first.plan2027.simulated && !/simulat/i.test(answer)) {
        answer += "\n\nNote: the 2027 bet readings used here are the app's simulated week-3 example, not real campaign data.";
      }
      return { answer, trace, proposals: ctx.proposals, model: usedModel, tokens, fallbacks: failures.length ? failures : undefined };
    }
    for (const c of r.toolCalls) {
      const result = await runTool(c.name, c.args, ctx);
      trace.push({ tool: c.name, args: c.args, summary: summarize(result) });
      msgs.push({ role: "tool", toolCallId: c.id, name: c.name, result });
    }
  }
  return { answer: "I needed too many steps to answer this. Please narrow the question (for example, one campaign or one date).", trace, proposals: ctx.proposals, model: usedModel, tokens };
}
