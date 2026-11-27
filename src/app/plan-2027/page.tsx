"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Badge, Button, Card, DecisionChip, Kpi, inputCls } from "@/components/ui";
import { inr, num, pct } from "@/lib/format";
import { evaluatePlan, type BetEval, type BetId, type Plan2027State } from "@/lib/plan2027";

type Draft = Plan2027State;

const unitText = (u: string) => (u === "%" ? "%" : u === "pts" ? "pts" : u);
const toNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function Plan2027() {
  const { state, mutate } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [made, setMade] = useState<Record<string, boolean>>({});
  const saved = state?.plan2027_inputs;

  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [saved]);

  // Same pure function the server uses, so labels update while you type.
  const ev = useMemo(() => (draft ? evaluatePlan(draft) : null), [draft]);
  if (!state || !draft || !ev || !saved) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const setTop = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: toNum(v) as never });
  const setBet = (id: BetId, k: "reading" | "scale_at" | "stop_below" | "budget_inr", v: string) =>
    setDraft({ ...draft, bets: { ...draft.bets, [id]: { ...draft.bets[id], [k]: toNum(v) } } });

  async function save() {
    setMsg(null);
    const patch: Record<string, unknown> = {
      budget_inr: draft!.budget_inr, cap_per_day: draft!.cap_per_day, plan_registrations: draft!.plan_registrations,
      week: draft!.week, registrations_to_date: draft!.registrations_to_date, bets: draft!.bets,
    };
    try {
      await mutate("/api/plan2027", "PATCH", patch);
      setMsg({ text: "Saved. Labels, forecast and the copilot now use these numbers.", ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  }

  async function makeTask(b: BetEval) {
    if (!b.action) return;
    const camp = b.campaign_name ? state!.snapshot.campaigns.find((c) => c.campaign_name === b.campaign_name) : undefined;
    const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    try {
      await mutate("/api/tasks", "POST", {
        title: `Bet ${b.rank} ${b.name} (${b.label === "scale" ? "Scale" : b.label === "change" ? "Change" : "Stop"}): ${b.action}`,
        description: `2027 plan, week ${ev!.week ?? "–"}. ${b.reason} Signal: ${b.signal}. Owner role: ${b.owner_role}.`,
        campaign_id: camp?.campaign_id ?? null,
        owner_id: camp?.owner_id ?? null,
        due_date: due,
        priority: b.label === "stop" ? "high" : "medium",
      });
      setMade({ ...made, [b.id]: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  }

  const p = ev.pace;
  const f = ev.forecast;
  const paceTone = p ? (p.status === "on_track" ? "good" : p.status === "behind" ? "bad" : "default") : "default";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">2027 plan: are our bets working?</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            The deck’s five bets (CampusFest 2027, Bengaluru, ₹5L). Each week, type each bet’s early signal: the label follows the deck’s Slide 3 lines,
            and a Change or Stop can become a task in one click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved.simulated && <Badge className="border-amber-300 bg-amber-50 text-amber-900">Simulated week-3 example: replace with real readings</Badge>}
          {dirty && <span className="text-xs text-orange-700">Unsaved changes</span>}
          <Button onClick={save} disabled={!dirty}>Save</Button>
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-blue-800" : "text-orange-800"}`}>{msg.text}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`Registrations, week ${p?.week ?? "–"}`}
          value={p ? num(p.registrations_to_date) : "–"}
          sub={p ? `Curve expects ${num(p.expected)} · ${pct(p.ratio, 0)} · ${p.status === "on_track" ? "on track" : p.status === "behind" ? "behind: reallocate" : "ahead: check capacity"}` : "Enter the week and registrations"}
          progress={p ? Math.min(1, p.ratio) : null}
          tone={paceTone}
        />
        <Kpi label="Forecast attendees" value={f ? num(f.unique_attendees) : "–"} sub="Base-case model on today’s pace · aim 3,000 base / 4,800 stretch" />
        <Kpi
          label="Day-1 peak vs venue cap"
          value={f ? `${num(f.day1_peak)} / ${num(f.cap_per_day)}` : "–"}
          sub={f ? (f.day1_status === "ok" ? `Alert above ${num(f.day1_alert_at)}` : "Near or over the cap: sell day passes") : ""}
          progress={f ? Math.min(1, f.day1_peak / f.cap_per_day) : null}
          tone={f && f.day1_status !== "ok" ? "bad" : "default"}
        />
        <Kpi
          label="Budget allocated"
          value={inr(ev.budget.allocated_inr)}
          sub={`of ${inr(ev.budget.total_inr)} · ${ev.budget.status === "balanced" ? "balanced" : ev.budget.status === "over" ? `over by ${inr(-ev.budget.gap_inr)}` : `${inr(ev.budget.gap_inr)} free`}`}
          tone={ev.budget.status === "over" ? "bad" : "default"}
        />
      </div>

      <Card
        title="Bets: scale, change or stop"
        subtitle={`${ev.counts.scale} scale · ${ev.counts.change} change · ${ev.counts.stop} stop · ${ev.counts.no_reading} waiting for a reading. Scale line = the model’s assumption holds; stop line ≈ half of it.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3">Bet</th>
                <th className="pr-3">This week’s signal</th>
                <th className="pr-3">Scale if ≥</th>
                <th className="pr-3">Stop if &lt;</th>
                <th className="pr-3">Call</th>
                <th className="pr-3">Next action</th>
                <th className="pr-3 text-right">Budget (₹)</th>
              </tr>
            </thead>
            <tbody>
              {ev.bets.map((b) => (
                <tr key={b.id} className="border-b border-stone-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-semibold">#{b.rank} {b.name}</p>
                    <p className="text-xs text-slate-500">{b.owner_role} · weeks {b.weeks} · +{num(b.extra_attendees.base)} / +{num(b.extra_attendees.stretch)} attendees</p>
                  </td>
                  <td className="pr-3">
                    <div className="flex items-center gap-1.5">
                      <NumInput label={`Bet ${b.rank} reading`} className={`${inputCls} w-20`} value={draft.bets[b.id].reading} onChange={(v) => setBet(b.id, "reading", v)} />
                      <span className="text-xs text-slate-500">{unitText(b.unit)}</span>
                    </div>
                    <p className="mt-1 max-w-[220px] text-xs text-slate-500">{b.signal}</p>
                  </td>
                  <td className="pr-3"><NumInput label={`Bet ${b.rank} scale line`} className={`${inputCls} w-16`} value={draft.bets[b.id].scale_at} onChange={(v) => setBet(b.id, "scale_at", v)} /></td>
                  <td className="pr-3"><NumInput label={`Bet ${b.rank} stop line`} className={`${inputCls} w-16`} value={draft.bets[b.id].stop_below} onChange={(v) => setBet(b.id, "stop_below", v)} /></td>
                  <td className="pr-3">
                    {b.label === "no_reading" ? <Badge>No reading yet</Badge> : <DecisionChip status={b.label} />}
                    <p className="mt-1 max-w-[200px] text-xs text-slate-500">{b.reason}</p>
                  </td>
                  <td className="pr-3">
                    {b.action ? (
                      <>
                        <p className="max-w-[240px]">{b.action}</p>
                        {made[b.id] ? (
                          <Link href="/tasks" className="text-xs font-semibold text-blue-800 underline">Task created: open Tasks</Link>
                        ) : (
                          <button onClick={() => makeTask(b)} disabled={dirty} title={dirty ? "Save first" : "Create a task with this action"} className="mt-1 text-xs font-semibold text-orange-700 underline disabled:text-slate-400">
                            Make this a task
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Waiting for week {b.gate_week} data</span>
                    )}
                  </td>
                  <td className="text-right"><NumInput label={`Bet ${b.rank} budget`} className={`${inputCls} w-24 text-right`} value={draft.bets[b.id].budget_inr} onChange={(v) => setBet(b.id, "budget_inr", v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Plus fixed lines: {ev.budget.other_lines.map((l) => `${l.name} ${inr(l.budget_inr)}`).join(" · ")}. {ev.budget.advice}
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Pace and capacity" subtitle="Inputs are constraints you can change; everything above recalculates.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumField label="Campaign week (1–10)" value={draft.week} onChange={(v) => setTop("week", v)} />
            <NumField label="Registrations so far" value={draft.registrations_to_date} onChange={(v) => setTop("registrations_to_date", v)} />
            <NumField label="Planned registrations" value={draft.plan_registrations} onChange={(v) => setTop("plan_registrations", v)} />
            <NumField label="Venue cap per day" value={draft.cap_per_day} onChange={(v) => setTop("cap_per_day", v)} />
            <NumField label="Total budget (₹)" value={draft.budget_inr} onChange={(v) => setTop("budget_inr", v)} />
          </div>
          <div className="mt-3 space-y-1 text-sm">
            {p && <p><b>Pace:</b> {p.advice}</p>}
            {f && <p><b>Capacity:</b> {f.advice} Most the venue can admit over two days: {num(ev.ceiling)} people.</p>}
            <p className="text-xs text-slate-500">Checkpoints for {num(draft.plan_registrations)} registrations: {(p?.checkpoints ?? []).map((c) => `wk ${c.week}: ${num(c.expected)}`).join(" · ")}</p>
          </div>
        </Card>
        <Card title="How these numbers are made">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {ev.assumptions.map((a) => <li key={a}>{a}</li>)}
            <li>The bets, lines and actions are the deck’s Slide 2 and 3. The 2025 pages (Overview, Campaigns, Diagnose) are the evidence behind them.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

// Keeps the typed text (so "0." or "" can be typed) and reports it upward on every change.
function NumInput({ label, value, onChange, className }: { label: string; value: number | null; onChange: (v: string) => void; className: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (toNum(text) !== value) setText(value == null ? "" : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input aria-label={label} className={className} inputMode="decimal" value={text} placeholder="–" onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />;
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-slate-600">
      {label}
      <NumInput label={label} className={`${inputCls} mt-1`} value={value} onChange={onChange} />
    </label>
  );
}
