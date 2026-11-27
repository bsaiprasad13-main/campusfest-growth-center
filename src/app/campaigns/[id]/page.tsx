"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/AppProvider";
import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";
import { Button, Card, DecisionChip, Field, inputCls, Kpi } from "@/components/ui";
import { inr, num, pct, STAGE_LABEL } from "@/lib/format";
import type { DailyRow } from "@/lib/types";

const NUM_FIELDS = ["impressions", "clicks", "landing_page_sessions", "registration_starts", "marketing_spend_inr"] as const;
const FIELD_LABEL: Record<string, string> = { impressions: "Impr.", clicks: "Clicks", landing_page_sessions: "Sessions", registration_starts: "Form starts", marketing_spend_inr: "Spend ₹" };

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, mutate, asOf } = useApp();
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan_status: string; planned_budget_inr: string; notes: string; owner_id: string } | null>(null);
  const [newRow, setNewRow] = useState({ activity_date: "", marketing_spend_inr: "0", impressions: "0", clicks: "0", landing_page_sessions: "0", registration_starts: "0" });

  const c = state?.snapshot.campaigns.find((x) => x.campaign_id === id);
  const loadRows = useCallback(async () => {
    const r = await fetch(`/api/daily?campaign_id=${id}`, { cache: "no-store" });
    if (r.ok) setRows(await r.json());
  }, [id]);
  useEffect(() => { loadRows(); }, [loadRows, state]);
  useEffect(() => {
    if (c) setPlan({ plan_status: c.plan_status, planned_budget_inr: c.planned_budget_inr?.toString() ?? "", notes: state?.plans[c.campaign_id]?.notes ?? "", owner_id: c.owner_id });
  }, [c?.campaign_id, c?.plan_status, c?.planned_budget_inr, c?.owner_id, state?.plans]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  if (!c) return <p className="text-sm">Campaign {id} not found. <Link className="underline" href="/campaigns">Back</Link></p>;
  const post = state.snapshot.event.phase === "post_event";
  const asOfDate = asOf ?? state.snapshot.as_of;
  const visibleRows = rows.filter((r) => r.activity_date <= asOfDate);
  const chart = [...visibleRows].sort((a, b) => a.activity_date.localeCompare(b.activity_date));
  const tasks = state.tasks.filter((t) => t.campaign_id === c.campaign_id);

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setMsg(null);
    try {
      await mutate(`/api/campaigns/${c!.campaign_id}`, "PATCH", {
        plan_status: plan.plan_status,
        planned_budget_inr: plan.planned_budget_inr === "" ? null : Number(plan.planned_budget_inr),
        notes: plan.notes,
        owner_id: plan.owner_id,
      });
      setMsg("Saved. Analytics updated.");
    } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); }
  }

  async function editCell(r: DailyRow, field: string, value: string) {
    if (String(r[field as keyof DailyRow]) === value) return;
    setMsg(null);
    try { await mutate(`/api/daily/${encodeURIComponent(r.activity_id)}`, "PATCH", { [field]: Number(value) }); setMsg(`Updated ${r.activity_id}. Analytics recalculated.`); } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); loadRows(); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/campaigns" className="text-xs text-blue-700 underline">← Campaigns</Link>
          <h1 className="text-2xl font-semibold">{c.campaign_name}</h1>
          <p className="text-sm text-slate-500">{c.channel} · owner {c.owner_name} · {c.target_audience}</p>
          <p className="text-sm text-slate-500">Objective: {c.objective}</p>
        </div>
        <div className="text-right">
          <DecisionChip status={c.decision.status} />
          <ul className="mt-1 text-xs text-slate-600">{c.decision.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Spend" value={inr(c.spend_inr)} sub={c.planned_budget_inr ? `of ${inr(c.planned_budget_inr)} planned` : `${pct(c.share_of_spend)} of all spend`} progress={c.budget_used_pct} />
        <Kpi label="Identified" value={num(c.identified_people)} sub={`${inr(c.cost_per_identified)} each`} />
        <Kpi label="Registered" value={num(c.registrations)} sub={`${inr(c.cost_per_registration)} each`} />
        <Kpi label="Attended" value={post ? num(c.attendees) : "–"} sub={post ? `${inr(c.cost_per_attendee)} each` : "known after the event"} />
        <Kpi label="Registrants who came" value={pct(c.rates.registered_to_attended)} sub={`all campaigns ${pct(state.snapshot.portfolio_rates.registered_to_attended)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Daily activity" subtitle="Spend (bars) and clicks (line) from daily marketing rows up to the selected date">
          <div className="h-60">
            <ResponsiveContainer>
              <ComposedChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="activity_date" tick={{ fontSize: 11 }} minTickGap={30} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar isAnimationActive={false} yAxisId="l" dataKey="marketing_spend_inr" name="Spend ₹" fill="#94a3b8" />
                <Line isAnimationActive={false} yAxisId="r" dataKey="clicks" name="Clicks" stroke="#ea580c" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Stage conversion vs all campaigns">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(c.rates).map(([k, v]) => {
                const p = state.snapshot.portfolio_rates[k as keyof typeof c.rates];
                const worse = v != null && p != null && v < p;
                return (
                  <tr key={k} className="border-b border-stone-100">
                    <td className="py-1.5 pr-2 text-slate-600">{STAGE_LABEL[k]}</td>
                    <td className={`pr-2 text-right tabular-nums ${worse ? "font-semibold text-orange-700" : ""}`}>{pct(v)}</td>
                    <td className="text-right text-xs tabular-nums text-slate-500">avg {pct(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Orange = below the all-campaign rate. The first three stages are anonymous event counts.</p>
        </Card>
      </div>

      <Card title="Plan and ownership" subtitle="Saved changes recalculate budget use and appear in the copilot's answers">
        {plan && (
          <form onSubmit={savePlan} className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <Field label="Plan status">
              <select className={inputCls} value={plan.plan_status} onChange={(e) => setPlan({ ...plan, plan_status: e.target.value })}>
                <option value="active">Active</option><option value="scaling">Scaling</option><option value="paused">Paused</option><option value="stopped">Stopped</option>
              </select>
            </Field>
            <Field label="Planned budget (₹)"><input type="number" min={0} className={inputCls} value={plan.planned_budget_inr} onChange={(e) => setPlan({ ...plan, planned_budget_inr: e.target.value })} placeholder="not set" /></Field>
            <Field label="Owner">
              <select className={inputCls} value={plan.owner_id} onChange={(e) => setPlan({ ...plan, owner_id: e.target.value })}>
                {state.owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
              </select>
            </Field>
            <Field label="Notes"><input className={inputCls} value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} /></Field>
            <div className="flex items-end"><Button type="submit">Save plan</Button></div>
          </form>
        )}
        {msg && <p className="mt-2 text-sm text-slate-700">{msg}</p>}
      </Card>

      <Card title="Tasks for this campaign">
        <div className="mb-3"><TaskForm fixedCampaign={c.campaign_id} /></div>
        <TaskList tasks={tasks} />
      </Card>

      <Card title="Daily marketing rows (editable)" subtitle="Edit a number and leave the cell to save. Duplicate import rows share an ID and are edited together. Negative spend = vendor credit.">
        <form
          className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-7"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            try {
              await mutate("/api/daily", "POST", { campaign_id: c.campaign_id, activity_date: newRow.activity_date, ...Object.fromEntries(NUM_FIELDS.map((f) => [f, Number(newRow[f])])) });
              setMsg("Row added. Analytics recalculated.");
            } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); }
          }}
        >
          <Field label="Date"><input type="date" required className={inputCls} value={newRow.activity_date} onChange={(e) => setNewRow({ ...newRow, activity_date: e.target.value })} /></Field>
          {NUM_FIELDS.map((f) => (
            <Field key={f} label={FIELD_LABEL[f]}><input type="number" className={inputCls} value={newRow[f]} onChange={(e) => setNewRow({ ...newRow, [f]: e.target.value })} /></Field>
          ))}
          <div className="flex items-end"><Button type="submit">Add row</Button></div>
        </form>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-stone-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2">Date</th><th className="pr-2">ID</th>
                {NUM_FIELDS.map((f) => <th key={f} className="pr-2 text-right">{FIELD_LABEL[f]}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={`${r.activity_id}-${i}`} className="border-b border-stone-100">
                  <td className="py-1 pr-2 tabular-nums">{r.activity_date}</td>
                  <td className="pr-2 text-xs text-slate-500">{r.activity_id}</td>
                  {NUM_FIELDS.map((f) => (
                    <td key={f} className="pr-1 text-right">
                      <input
                        aria-label={`${FIELD_LABEL[f]} on ${r.activity_date}`}
                        type="number"
                        defaultValue={r[f]}
                        onBlur={(e) => editCell(r, f, e.target.value)}
                        className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums hover:border-stone-300 focus:border-slate-500 focus:outline-none"
                      />
                    </td>
                  ))}
                  <td>
                    <Button variant="ghost" onClick={async () => { if (confirm(`Delete row ${r.activity_id}?`)) { try { await mutate(`/api/daily/${encodeURIComponent(r.activity_id)}`, "DELETE"); } catch (x) { setMsg(String(x)); } } }}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
