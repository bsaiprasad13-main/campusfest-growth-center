"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, Card, DecisionChip, Field, inputCls } from "@/components/ui";
import { inr, num, pct, STAGE_LABEL } from "@/lib/format";

export default function Campaigns() {
  const { state, mutate } = useApp();
  const [showNew, setShowNew] = useState(false);
  const [f, setF] = useState({ campaign_name: "", channel: "", owner_id: "", target_audience: "", objective: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!state) return null;
  const s = state.snapshot;
  const post = s.event.phase === "post_event";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-slate-500">Per-campaign funnel, cost and the live scale / change / stop call. Hover a status to see why.</p>
        </div>
        <Button onClick={() => setShowNew(!showNew)}>{showNew ? "Cancel" : "New campaign"}</Button>
      </div>

      {showNew && (
        <Card title="New campaign">
          <form
            className="grid grid-cols-1 gap-2 md:grid-cols-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try { await mutate("/api/campaigns", "POST", f); setShowNew(false); setF({ campaign_name: "", channel: "", owner_id: "", target_audience: "", objective: "" }); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
            }}
          >
            <Field label="Name"><input className={inputCls} required value={f.campaign_name} onChange={(e) => setF({ ...f, campaign_name: e.target.value })} /></Field>
            <Field label="Channel"><input className={inputCls} required value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="e.g. referrals" /></Field>
            <Field label="Owner">
              <select className={inputCls} required value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>
                <option value="">Choose…</option>
                {state.owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
              </select>
            </Field>
            <Field label="Audience"><input className={inputCls} value={f.target_audience} onChange={(e) => setF({ ...f, target_audience: e.target.value })} /></Field>
            <div className="flex items-end"><Button type="submit">Create</Button></div>
            {err && <p className="text-sm text-orange-700 md:col-span-5">{err}</p>}
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3">Campaign</th>
                <th className="pr-3">Owner</th>
                <th className="pr-3 text-right">Spend</th>
                <th className="pr-3 text-right">Budget used</th>
                <th className="pr-3 text-right">Identified</th>
                <th className="pr-3 text-right">Registered</th>
                <th className="pr-3 text-right">Attended</th>
                <th className="pr-3 text-right">₹ / reg</th>
                <th className="pr-3 text-right">₹ / attendee</th>
                <th className="pr-3 text-right">Came</th>
                <th className="pr-3">Call</th>
                <th className="pr-3">Weakest stage vs average</th>
              </tr>
            </thead>
            <tbody>
              {s.campaigns.map((c) => (
                <tr key={c.campaign_id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="py-2 pr-3">
                    <Link href={`/campaigns/${c.campaign_id}`} className="font-medium text-blue-800 underline-offset-2 hover:underline">{c.campaign_name}</Link>
                    <span className="block text-xs text-slate-500">{c.channel} · {c.plan_status}</span>
                  </td>
                  <td className="pr-3">{c.owner_name}</td>
                  <td className="pr-3 text-right tabular-nums">{inr(c.spend_inr)}</td>
                  <td className="pr-3 text-right tabular-nums">{c.budget_used_pct == null ? <span className="text-slate-400" title="No planned budget set for this campaign (the 2025 data has none). Set one on the campaign page.">–</span> : pct(c.budget_used_pct, 0)}</td>
                  <td className="pr-3 text-right tabular-nums">{num(c.identified_people)}</td>
                  <td className="pr-3 text-right tabular-nums">{num(c.registrations)}</td>
                  <td className="pr-3 text-right tabular-nums">{post ? num(c.attendees) : "–"}</td>
                  <td className="pr-3 text-right tabular-nums">{inr(c.cost_per_registration)}</td>
                  <td className="pr-3 text-right tabular-nums">{inr(c.cost_per_attendee)}</td>
                  <td className="pr-3 text-right tabular-nums">{pct(c.rates.registered_to_attended)}</td>
                  <td className="pr-3"><DecisionChip status={c.decision.status} title={c.decision.reasons.join("; ")} /></td>
                  <td className="pr-3 text-xs text-slate-600">{c.bottleneck ? `${STAGE_LABEL[c.bottleneck.stage]}: ${pct(c.bottleneck.rate)} vs ${pct(c.bottleneck.portfolio_rate)}` : "At or above average everywhere"}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3">All campaigns{s.totals.walk_in_attendees ? ` (+${s.totals.walk_in_attendees} walk-ins)` : ""}</td>
                <td />
                <td className="pr-3 text-right tabular-nums">{inr(s.totals.spend_inr)}</td>
                <td className="pr-3 text-right tabular-nums">{pct(s.progress.budget_used_pct, 0)}</td>
                <td className="pr-3 text-right tabular-nums">{num(s.campaigns.reduce((a, c) => a + c.identified_people, 0))}</td>
                <td className="pr-3 text-right tabular-nums">{num(s.totals.registrations)}</td>
                <td className="pr-3 text-right tabular-nums">{post ? num(s.totals.unique_attendees) : "–"}</td>
                <td className="pr-3 text-right tabular-nums">{inr(s.totals.cost_per_registration)}</td>
                <td className="pr-3 text-right tabular-nums">{inr(s.totals.cost_per_attendee)}</td>
                <td className="pr-3 text-right tabular-nums">{pct(s.totals.show_rate)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Attended = distinct external people with a verified admission, credited to the campaign on their registration. Budget used needs a planned budget, set on the campaign page.
        </p>
      </Card>
    </div>
  );
}
