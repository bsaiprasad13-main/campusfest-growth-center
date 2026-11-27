"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { Button } from "./ui";
import type { Proposal } from "@/lib/copilot/tools";
import type { TraceStep } from "@/lib/copilot/agent";

interface Msg {
  role: "user" | "assistant";
  text: string;
  trace?: TraceStep[];
  proposals?: (Proposal & { state?: "pending" | "done" | "dismissed" | "error"; error?: string })[];
  error?: boolean;
  detail?: string;
  model?: string;
  tokens?: number;
  fallbacks?: string[];
}

const SUGGESTIONS = [
  "Which 2027 bet has crossed a stop line, and what should we do?",
  "Which campaigns should we scale, change or stop, and why?",
  "Where is Paid Social losing people in the funnel?",
  "If we move ₹30,000 from Creator Partners to Student Referrals, what happens?",
  "Which college sent the most attendees?",
  "How were registrations tracking against target on 1 March?",
];

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

type Block = { kind: "line"; text: string; i: number } | { kind: "table"; rows: string[][]; i: number };

// Minimal, safe markdown: **bold**, bullet lines, numbered lines, tables, paragraphs. No HTML injection.
function Rich({ text }: { text: string }) {
  // **bold**, `code` and <br> line breaks (models put these inside table cells); everything else is plain text.
  const inline = (s: string, k: number | string) =>
    s.split(/<br\s*\/?>/gi).map((part, pi) => (
      <span key={`${k}-l${pi}`}>
        {pi > 0 && <br />}
        {part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) =>
          seg.startsWith("**") && seg.endsWith("**") ? <b key={i}>{seg.slice(2, -2)}</b>
          : seg.startsWith("`") && seg.endsWith("`") && seg.length > 1 ? <code key={i} className="rounded bg-stone-200 px-1">{seg.slice(1, -1)}</code>
          : <span key={i}>{seg}</span>,
        )}
      </span>
    ));
  const blocks: Block[] = [];
  text.split("\n").forEach((l, i) => {
    if (isRow(l)) {
      if (isSeparator(l)) return;
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "table") last.rows.push(cells(l));
      else blocks.push({ kind: "table", rows: [cells(l)], i });
    } else blocks.push({ kind: "line", text: l, i });
  });
  return (
    <div className="space-y-1">
      {blocks.map((b) => {
        if (b.kind === "table") {
          const [head, ...body] = b.rows;
          return (
            <div key={b.i} className="overflow-x-auto">
              <table className="my-1 w-full text-xs">
                <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-stone-300 px-1.5 py-1 text-left font-semibold">{inline(c, `${b.i}h${j}`)}</th>)}</tr></thead>
                <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-stone-200 px-1.5 py-1 align-top">{inline(c, `${b.i}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        const l = b.text;
        const i = b.i;
        const m = l.match(/^\s*([-*•]|\d+\.)\s+(.*)$/);
        if (m) return <div key={i} className="flex gap-1.5 pl-1"><span className="text-slate-400">{/\d/.test(m[1]) ? m[1] : "•"}</span><span>{inline(m[2], i)}</span></div>;
        if (/^#{1,4}\s/.test(l)) return <p key={i} className="font-semibold">{inline(l.replace(/^#{1,4}\s/, ""), i)}</p>;
        return l.trim() ? <p key={i}>{inline(l, i)}</p> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

export function Copilot() {
  const { state, asOf, mutate } = useApp();
  // The panel only mounts in the browser (after a click), so the saved chat can be read at mount.
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem("copilot-chat") ?? "[]") as Msg[]; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitS, setWaitS] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem("copilot-chat", JSON.stringify(msgs.slice(-30))); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      // One automatic retry when the free AI tier is briefly rate-limited.
      for (let attempt = 0; ; attempt++) {
        const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history, asOf: asOf ?? state?.snapshot.as_of }) });
        const j = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
        if (r.ok) {
          setMsgs((m) => [...m, { role: "assistant", text: j.answer, trace: j.trace, model: j.model, tokens: j.tokens, fallbacks: j.fallbacks, proposals: (j.proposals ?? []).map((p: Proposal) => ({ ...p, state: "pending" })) }]);
          break;
        }
        if (r.status === 429 && attempt === 0 && typeof j.retry_after_s === "number") {
          for (let s = j.retry_after_s; s > 0; s--) {
            setWaitS(s);
            await new Promise((res) => setTimeout(res, 1000));
          }
          setWaitS(null);
          continue;
        }
        setMsgs((m) => [...m, { role: "assistant", text: `${j.error ?? `Request failed (${r.status})`}${r.status === 429 ? " Please ask again in a minute." : ""}`, detail: j.detail, error: true }]);
        break;
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setWaitS(null);
      setBusy(false);
    }
  }

  async function act(mi: number, pi: number, confirm: boolean) {
    const p = msgs[mi].proposals![pi];
    const update = (patch: Partial<(typeof p)>) =>
      setMsgs((all) => all.map((m, i) => (i !== mi ? m : { ...m, proposals: m.proposals!.map((x, j) => (j === pi ? { ...x, ...patch } : x)) })));
    if (!confirm) return update({ state: "dismissed" });
    try {
      if (p.kind === "create_task") await mutate("/api/tasks", "POST", { ...p.payload, created_by: "copilot" });
      else await mutate(`/api/campaigns/${p.target_id}`, "PATCH", p.payload);
      update({ state: "done" });
    } catch (e) {
      update({ state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <aside className="sticky top-[49px] flex h-[calc(100vh-49px)] w-full max-w-md shrink-0 flex-col border-l border-stone-200 bg-white" aria-label="AI growth copilot">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold">Growth copilot</p>
          <p className="text-xs text-slate-500">Answers from live app data as of {asOf ?? state?.snapshot.as_of}</p>
        </div>
        {msgs.length > 0 && <Button variant="ghost" onClick={() => setMsgs([])}>Clear</Button>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-slate-600">Ask about performance, bottlenecks, budget moves or tasks. I compute from the current data and say when it can’t answer.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-slate-700 hover:bg-stone-50">{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-slate-900 px-3 py-2 text-white" : `mr-2 rounded-xl px-3 py-2 ${m.error ? "border border-orange-300 bg-orange-50 text-orange-900" : "bg-stone-100 text-slate-900"}`}>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.text}</p> : <Rich text={m.text} />}
            {m.detail && <details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Technical details</summary><p className="break-words">{m.detail}</p></details>}
            {m.proposals?.map((p, j) => (
              <div key={p.id} className="mt-2 rounded-lg border border-orange-300 bg-white p-2">
                <p className="text-xs font-semibold text-orange-800">Proposed action: needs your confirmation</p>
                <p className="font-medium">{p.summary}</p>
                {typeof p.payload.description === "string" && p.payload.description && <p className="text-xs text-slate-600">{p.payload.description}</p>}
                {p.kind === "create_task" && (
                  <p className="text-xs text-slate-500">
                    Owner: {state?.owners.find((o) => o.owner_id === p.payload.owner_id)?.owner_name ?? "Unassigned"} · Due: {String(p.payload.due_date ?? "none")} · Priority: {String(p.payload.priority)}
                  </p>
                )}
                {p.kind === "update_campaign" && typeof p.payload.notes === "string" && <p className="text-xs text-slate-600">Reason: {p.payload.notes}</p>}
                <div className="mt-1.5 flex gap-2">
                  {p.state === "pending" && (<><Button onClick={() => act(i, j, true)}>Confirm</Button><Button variant="ghost" onClick={() => act(i, j, false)}>Dismiss</Button></>)}
                  {p.state === "done" && <span className="text-xs font-semibold text-blue-800">Done: saved and analytics updated.</span>}
                  {p.state === "dismissed" && <span className="text-xs text-slate-500">Dismissed.</span>}
                  {p.state === "error" && <span className="text-xs text-orange-800">Failed: {p.error}</span>}
                </div>
              </div>
            ))}
            {m.trace && m.trace.length > 0 && (
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer">How I got this ({m.trace.length} data look-up{m.trace.length > 1 ? "s" : ""})</summary>
                <ul className="mt-1 space-y-1">
                  {m.trace.map((t, k) => (
                    <li key={k} className="break-words"><code className="text-slate-700">{t.tool}</code>({JSON.stringify(t.args)}) → {t.summary}</li>
                  ))}
                </ul>
                {m.model && <p className="mt-1">Model: {m.model}{m.tokens ? ` · ${m.tokens.toLocaleString("en-IN")} tokens` : ""}{m.fallbacks?.length ? ` · after: ${m.fallbacks.join("; ")}` : ""}</p>}
              </details>
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-slate-500">{waitS != null ? `The free AI tier is busy. Retrying automatically in ${waitS}s…` : "Analysing the data…"}</p>}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-stone-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label htmlFor="copilot-input" className="sr-only">Ask the copilot</label>
        <textarea
          id="copilot-input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="e.g. Why did we miss the registration target?"
          className="flex-1 resize-none rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
        <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
      </form>
    </aside>
  );
}
