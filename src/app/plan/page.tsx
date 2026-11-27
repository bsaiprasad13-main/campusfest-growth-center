"use client";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, Card, Field, inputCls } from "@/components/ui";
import { inr, num, pct } from "@/lib/format";
import { simulatePlan } from "@/lib/planner";

export default function Plan() {
  const { state, mutate } = useApp();
  const s = state?.snapshot;
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [elasticity, setElasticity] = useState(0.4);
  const [uplift, setUplift] = useState(0);
  const [walkin, setWalkin] = useState(0.06);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [assumed, setAssumed] = useState({ show: "", walk: "" });
  const [tgt, setTgt] = useState({ effective_date: "", target_version: "", identified_external_people_goal: "", registration_goal: "", unique_external_visitors_goal: "", marketing_budget_inr: "" });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setRules(Object.fromEntries(Object.entries(state.settings.rules).map(([k, v]) => [k, String(v)])));
    setAssumed({ show: String(state.settings.assumed_show_rate), walk: String(state.settings.assumed_walkin_share) });
  }, [state?.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo(
    () => (s ? simulatePlan(s, { allocation: alloc, elasticity, show_uplift_pts: uplift, walkin_share: walkin, max_show_rate: 0.92 }) : null),
    [s, alloc, elasticity, uplift, walkin],
  );
  if (!state || !s || !result) return null;
  const target = s.targets;

  async function save(url: string, method: string, body: unknown, ok: string) {
    setMsg(null);
    try { await mutate(url, method, body); setMsg(ok); } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Plan & decide</h1>
        <p className="text-sm text-slate-500">Test budget moves before making them, and tune the rules behind every scale / change / stop call.</p>
      </div>

      <Card
        title="Budget reallocation simulator"
        subtitle="Uses each campaign's live cost per registration and show rate. Inputs marked [assumption] are not in the data."
        right={<Button variant="secondary" onClick={() => setAlloc({})}>Reset to actual spend</Button>}
      >
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label={`Diminishing returns exponent [assumption]: ${elasticity}`}>
            <input type="range" min={0} max={1} step={0.05} value={elasticity} onChange={(e) => setElasticity(Number(e.target.value))} className="w-full" />
          </Field>
          <Field label={`Show-rate uplift [assumption]: +${uplift} pts`}>
            <input type="range" min={0} max={15} step={1} value={uplift} onChange={(e) => setUplift(Number(e.target.value))} className="w-full" />
          </Field>
          <Field label={`Walk-in share [assumption]: ${(walkin * 100).toFixed(0)}%`}>
            <input type="range" min={0} max={0.2} step={0.01} value={walkin} onChange={(e) => setWalkin(Number(e.target.value))} className="w-full" />
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">Campaign</th><th className="pr-2 text-right">Actual spend</th><th className="pr-2">Planned spend (₹)</th>
                <th className="pr-2 text-right">₹ / reg</th><th className="pr-2 text-right">Regs</th><th className="pr-2 text-right">Came</th><th className="pr-2 text-right">Attendees</th><th className="pr-2 text-right">₹ / attendee</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.campaign_id} className="border-b border-stone-100">
                  <td className="py-1.5 pr-2">{r.campaign_name}</td>
                  <td className="pr-2 text-right tabular-nums">{inr(r.current_spend)}</td>
                  <td className="pr-2">
                    <input aria-label={`Planned spend for ${r.campaign_name}`} type="number" min={0} step={1000} className={`${inputCls} w-32`} value={alloc[r.campaign_id] ?? r.current_spend} onChange={(e) => setAlloc({ ...alloc, [r.campaign_id]: Number(e.target.value) })} />
                  </td>
                  <td className="pr-2 text-right tabular-nums">{inr(r.cost_per_registration)}</td>
                  <td className="pr-2 text-right tabular-nums">{num(r.registrations)}</td>
                  <td className="pr-2 text-right tabular-nums">{pct(r.show_rate)}</td>
                  <td className="pr-2 text-right tabular-nums">{num(r.attendees)}</td>
                  <td className="pr-2 text-right tabular-nums">{inr(r.cost_per_attendee)}</td>
                  <td className="text-xs text-orange-800">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div><p className="text-xs text-slate-500">Planned spend</p><p className="font-semibold">{inr(result.total_spend)}</p><p className="text-xs text-slate-500">budget {inr(target?.marketing_budget_inr)}</p></div>
          <div><p className="text-xs text-slate-500">Registrations</p><p className="font-semibold">{num(result.registrations)}</p></div>
          <div><p className="text-xs text-slate-500">Registered attendees + walk-ins</p><p className="font-semibold">{num(result.registered_attendees)} + {num(result.walk_ins)}</p></div>
          <div><p className="text-xs text-slate-500">Unique attendees</p><p className="text-xl font-semibold">{num(result.unique_attendees)}</p><p className="text-xs text-slate-500">target {num(target?.unique_external_visitors_goal)} · actual {num(s.totals.unique_attendees)}</p></div>
          <div><p className="text-xs text-slate-500">₹ per attendee</p><p className="font-semibold">{inr(result.cost_per_attendee)}</p></div>
        </div>
        <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
          {result.assumptions.map((a) => <li key={a}>{a}</li>)}
          {result.warnings.map((w) => <li key={w} className="text-orange-800">{w}</li>)}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Scale / change / stop rules" subtitle="Saved rules re-classify every campaign immediately">
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save("/api/settings", "PATCH", {
                rules: Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, Number(v)])),
                assumed_show_rate: Number(assumed.show),
                assumed_walkin_share: Number(assumed.walk),
              }, "Rules saved. Campaign calls updated.");
            }}
          >
            <p className="col-span-2 text-xs font-semibold text-slate-600">After the event (cost per verified attendee, share who came)</p>
            <Field label="Scale if ₹/attendee ≤"><input className={inputCls} type="number" value={rules.scale_max_cost_per_attendee ?? ""} onChange={(e) => setRules({ ...rules, scale_max_cost_per_attendee: e.target.value })} /></Field>
            <Field label="…and share who came ≥ (0–1)"><input className={inputCls} type="number" step="0.01" value={rules.scale_min_show_rate ?? ""} onChange={(e) => setRules({ ...rules, scale_min_show_rate: e.target.value })} /></Field>
            <Field label="Stop if ₹/attendee ≥"><input className={inputCls} type="number" value={rules.stop_min_cost_per_attendee ?? ""} onChange={(e) => setRules({ ...rules, stop_min_cost_per_attendee: e.target.value })} /></Field>
            <Field label="…or share who came < (0–1)"><input className={inputCls} type="number" step="0.01" value={rules.stop_max_show_rate ?? ""} onChange={(e) => setRules({ ...rules, stop_max_show_rate: e.target.value })} /></Field>
            <p className="col-span-2 mt-1 text-xs font-semibold text-slate-600">Before the event (cost per registration)</p>
            <Field label="Scale if ₹/registration ≤"><input className={inputCls} type="number" value={rules.scale_max_cost_per_registration ?? ""} onChange={(e) => setRules({ ...rules, scale_max_cost_per_registration: e.target.value })} /></Field>
            <Field label="Stop if ₹/registration ≥"><input className={inputCls} type="number" value={rules.stop_min_cost_per_registration ?? ""} onChange={(e) => setRules({ ...rules, stop_min_cost_per_registration: e.target.value })} /></Field>
            <p className="col-span-2 mt-1 text-xs font-semibold text-slate-600">Projection assumptions (before the event)</p>
            <Field label="Assumed share of registrants who come"><input className={inputCls} type="number" step="0.01" value={assumed.show} onChange={(e) => setAssumed({ ...assumed, show: e.target.value })} /></Field>
            <Field label="Assumed walk-in share of attendees"><input className={inputCls} type="number" step="0.01" value={assumed.walk} onChange={(e) => setAssumed({ ...assumed, walk: e.target.value })} /></Field>
            <div className="col-span-2"><Button type="submit">Save rules</Button></div>
          </form>
        </Card>

        <Card title="Targets and budget versions" subtitle="A new version applies from its date; earlier snapshots keep the version in force then">
          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500"><th className="py-1">Version</th><th className="pl-3">From</th><th className="pl-3 text-right">Identified</th><th className="pl-3 text-right">Regs</th><th className="pl-3 text-right">Attendees</th><th className="pl-3 text-right">Budget</th></tr>
            </thead>
            <tbody>
              {state.targets_history.map((t) => (
                <tr key={t.effective_at + t.target_version} className={`border-t border-stone-100 ${s.targets?.effective_at === t.effective_at ? "font-semibold" : ""}`}>
                  <td className="py-1">{t.target_version}{s.targets?.effective_at === t.effective_at ? " (in force)" : ""}</td>
                  <td className="pl-3 tabular-nums">{t.effective_at.slice(0, 10)}</td>
                  <td className="pl-3 text-right tabular-nums">{num(t.identified_external_people_goal)}</td>
                  <td className="pl-3 text-right tabular-nums">{num(t.registration_goal)}</td>
                  <td className="pl-3 text-right tabular-nums">{num(t.unique_external_visitors_goal)}</td>
                  <td className="pl-3 text-right tabular-nums">{inr(t.marketing_budget_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="grid grid-cols-2 gap-2 md:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); save("/api/targets", "POST", tgt, "Target version added."); }}
          >
            <Field label="Effective date"><input type="date" required className={inputCls} value={tgt.effective_date} onChange={(e) => setTgt({ ...tgt, effective_date: e.target.value })} /></Field>
            <Field label="Version name"><input className={inputCls} value={tgt.target_version} onChange={(e) => setTgt({ ...tgt, target_version: e.target.value })} /></Field>
            <Field label="Identified goal"><input type="number" required className={inputCls} value={tgt.identified_external_people_goal} onChange={(e) => setTgt({ ...tgt, identified_external_people_goal: e.target.value })} /></Field>
            <Field label="Registration goal"><input type="number" required className={inputCls} value={tgt.registration_goal} onChange={(e) => setTgt({ ...tgt, registration_goal: e.target.value })} /></Field>
            <Field label="Attendee goal"><input type="number" required className={inputCls} value={tgt.unique_external_visitors_goal} onChange={(e) => setTgt({ ...tgt, unique_external_visitors_goal: e.target.value })} /></Field>
            <Field label="Budget ₹"><input type="number" required className={inputCls} value={tgt.marketing_budget_inr} onChange={(e) => setTgt({ ...tgt, marketing_budget_inr: e.target.value })} /></Field>
            <div className="col-span-2 md:col-span-3"><Button type="submit">Add version</Button></div>
          </form>
        </Card>
      </div>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
    </div>
  );
}
