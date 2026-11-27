"use client";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/AppProvider";
import { Card, DecisionChip, Kpi } from "@/components/ui";
import { inr, num, pct, STAGE_LABEL } from "@/lib/format";

function FunnelBar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  return (
    <div className="grid grid-cols-[150px_1fr_90px] items-center gap-2 text-sm">
      <span className="text-slate-700">{label}</span>
      <div className="h-5 rounded bg-stone-100">
        <div className="h-5 rounded bg-slate-700" style={{ width: `${max ? Math.max(1, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="text-right font-medium tabular-nums">
        {num(value)}
        {note && <span className="block text-[11px] font-normal text-slate-500">{note}</span>}
      </span>
    </div>
  );
}

export default function Overview() {
  const { state } = useApp();
  if (!state) return null;
  const s = state.snapshot;
  const t = s.totals;
  const tg = s.targets;
  const post = s.event.phase === "post_event";
  const conv = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}% of prev.` : "");
  const counts = { scale: 0, change: 0, stop: 0, insufficient_data: 0 } as Record<string, number>;
  s.campaigns.forEach((c) => (counts[c.decision.status] = (counts[c.decision.status] ?? 0) + 1));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-slate-500">
          North star: unique verified external attendees. Targets in force: <b>{tg?.target_version ?? "none yet"}</b>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Unique attendees"
          value={num(t.unique_attendees)}
          sub={tg ? `Target ${num(tg.unique_external_visitors_goal)} · ${pct(s.progress.attendees_pct)} · ${num(t.walk_in_attendees)} walk-ins` : "No target in force"}
          progress={s.progress.attendees_pct}
          tone={s.progress.attendees_pct != null && s.progress.attendees_pct >= 1 ? "good" : post ? "bad" : "default"}
        />
        <Kpi
          label="Registrations"
          value={num(t.registrations)}
          sub={tg ? `Target ${num(tg.registration_goal)} · ${pct(s.progress.registrations_pct)}${s.progress.linear_pace_registrations != null && !post ? ` · pace line ${num(s.progress.linear_pace_registrations)}` : ""}` : ""}
          progress={s.progress.registrations_pct}
          tone={s.progress.registrations_pct != null && s.progress.registrations_pct >= 1 ? "good" : post ? "bad" : "default"}
        />
        <Kpi
          label="Identified people"
          value={num(t.identified_people)}
          sub={tg ? `Target ${num(tg.identified_external_people_goal)} · ${pct(s.progress.identified_pct)}` : ""}
          progress={s.progress.identified_pct}
          tone={s.progress.identified_pct != null && s.progress.identified_pct >= 1 ? "good" : "default"}
        />
        <Kpi
          label="Marketing spend"
          value={inr(t.spend_inr)}
          sub={t.budget_inr != null ? `Budget ${inr(t.budget_inr)} · ${inr(t.budget_remaining_inr)} left` : ""}
          progress={s.progress.budget_used_pct}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Funnel: reach → registrations → actual attendees"
          subtitle="Top block = anonymous platform event counts (not unique people). Bottom block = identified external people."
        >
          <div className="space-y-1.5">
            <FunnelBar label="Impressions" value={t.impressions} max={t.impressions} />
            <FunnelBar label="Clicks" value={t.clicks} max={t.impressions} note={conv(t.clicks, t.impressions)} />
            <FunnelBar label="Page sessions" value={t.landing_page_sessions} max={t.impressions} note={conv(t.landing_page_sessions, t.clicks)} />
            <FunnelBar label="Form starts" value={t.registration_starts} max={t.impressions} note={conv(t.registration_starts, t.landing_page_sessions)} />
          </div>
          <hr className="my-3 border-stone-200" />
          <div className="space-y-1.5">
            <FunnelBar label="Identified people" value={t.identified_people} max={t.identified_people} />
            <FunnelBar label="Registered" value={t.registrations} max={t.identified_people} note={conv(t.registrations, t.identified_people)} />
            <FunnelBar label="Confirmed now" value={t.status_counts.confirmed ?? 0} max={t.identified_people} note={conv(t.status_counts.confirmed ?? 0, t.registrations)} />
            <FunnelBar label="Attended (registered)" value={t.registered_attendees} max={t.identified_people} note={post ? conv(t.registered_attendees, t.registrations) + " regs" : "event not over"} />
            <FunnelBar label="+ Walk-ins" value={t.walk_in_attendees} max={t.identified_people} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Cost per registration</p><p className="font-semibold">{inr(t.cost_per_registration)}</p></div>
            <div><p className="text-xs text-slate-500">Cost per attendee</p><p className="font-semibold">{post ? inr(t.cost_per_attendee) : "after event"}</p></div>
            <div><p className="text-xs text-slate-500">Registrants who came</p><p className="font-semibold">{pct(t.show_rate)}</p></div>
            <div><p className="text-xs text-slate-500">Came on both days</p><p className="font-semibold">{num(t.attendees_both_days)}</p></div>
          </div>
        </Card>

        <Card title={post ? "Outcome" : "Projection"} subtitle={post ? "Event over: actuals" : "Run-rate forecast; assumptions are labelled"}>
          <p className="text-3xl font-semibold">{num(s.projection.projected_unique_attendees)}</p>
          <p className="text-sm text-slate-600">
            {post ? "unique attendees" : "projected unique attendees"} {tg && <>vs target {num(tg.unique_external_visitors_goal)}</>}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Registrations: <b>{num(s.projection.projected_registrations)}</b> {tg && <>vs target {num(tg.registration_goal)}</>}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-500">
            {s.projection.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          {t.lost_registrations && (
            <div className="mt-4 rounded-lg bg-stone-50 p-3 text-sm">
              <p className="font-medium">Registrants who did not attend: {num(t.registrations - t.registered_attendees)}</p>
              <ul className="mt-1 space-y-0.5 text-slate-600">
                <li>Confirmed but no-show: {num(t.lost_registrations.confirmed_no_show)}</li>
                <li>Cancelled: {num(t.lost_registrations.cancelled)}</li>
                <li>Waitlisted, never admitted: {num(t.lost_registrations.waitlisted)}</li>
                <li>Never confirmed: {num(t.lost_registrations.interested_only)}</li>
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Registrations vs target pace" subtitle="Pace line = registration goal in force, spread evenly from the history start to the event (assumption: linear).">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={s.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line isAnimationActive={false} type="monotone" dataKey="cum_registrations" name="Registrations (cumulative)" stroke="#1e293b" dot={false} strokeWidth={2} />
                <Line isAnimationActive={false} type="monotone" dataKey="target_pace_registrations" name="Target pace" stroke="#ea580c" dot={false} strokeDasharray="5 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Scale / change / stop" subtitle={`Rules in Plan & decide. Basis: ${post ? "cost per attendee + show rate" : "cost per registration"}.`} right={<Link href="/campaigns" className="text-xs text-blue-700 underline">All campaigns</Link>}>
          <div className="space-y-2">
            {s.campaigns.map((c) => (
              <Link key={c.campaign_id} href={`/campaigns/${c.campaign_id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
                <span className="text-sm">
                  {c.campaign_name}
                  {c.bottleneck && <span className="block text-[11px] text-slate-500">Weakest stage: {STAGE_LABEL[c.bottleneck.stage]} ({pct(c.bottleneck.relative_gap, 0)} vs avg)</span>}
                </span>
                <DecisionChip status={c.decision.status} title={c.decision.reasons.join("; ")} />
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {counts.scale} scale · {counts.change} change · {counts.stop} stop
          </p>
        </Card>
      </div>

      <Card title="Data rules applied" subtitle="How raw records become these numbers">
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-600 md:grid-cols-2">
          <li>Duplicate import rows removed: {Object.entries(s.data_quality.duplicates_removed).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</li>
          <li>Internal / staff / test people admitted (excluded): {num(s.data_quality.excluded_non_external_admissions)}</li>
          <li>Denied check-ins: {num(s.data_quality.denied_checkins)} · pending/unverified: {num(s.data_quality.pending_or_unverified_checkins)} (not attendance)</li>
          <li>Vendor credit rows (negative spend) netted in: {num(s.data_quality.vendor_credit_rows)}</li>
          <li>Attendees with no campaign (walk-ins): {num(s.data_quality.unattributed_attendees)}</li>
          <li>Total verified admissions (both days): {num(t.admissions_verified_events)} records for {num(t.unique_attendees)} people</li>
        </ul>
      </Card>
    </div>
  );
}
