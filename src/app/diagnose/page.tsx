"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/AppProvider";
import { Card, Empty } from "@/components/ui";
import { num, pct, STAGE_LABEL } from "@/lib/format";
import type { StageRates } from "@/lib/engine";

const EVENT_LABEL: Record<string, string> = {
  brochure_download: "Downloaded the brochure",
  event_question_submitted: "Asked a question",
  nurture_email_opened: "Opened a nurture email",
  nurture_email_clicked: "Clicked a nurture email",
  opted_out: "Opted out of messages",
  registration_start: "Started the form (identified)",
  page_visit: "Visited the info page",
};

function cellColor(ratio: number | null) {
  if (ratio == null) return "bg-stone-50 text-slate-400";
  if (ratio <= -0.2) return "bg-orange-200 text-orange-950";
  if (ratio < -0.05) return "bg-orange-50 text-orange-900";
  if (ratio >= 0.1) return "bg-blue-100 text-blue-950";
  return "bg-white text-slate-800";
}

export default function Diagnose() {
  const { state } = useApp();
  if (!state) return null;
  const s = state.snapshot;
  const stages = Object.keys(s.portfolio_rates) as (keyof StageRates)[];
  const share = s.campaigns.map((c) => ({
    name: c.campaign_name,
    "Share of spend": c.share_of_spend != null ? Math.round(c.share_of_spend * 1000) / 10 : 0,
    "Share of attendees": c.share_of_attendees != null ? Math.round(c.share_of_attendees * 1000) / 10 : 0,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Diagnose</h1>
        <p className="text-sm text-slate-500">Where each campaign leaks, compared with the average of all campaigns at the same stage.</p>
      </div>

      <Card title="Stage conversion heatmap" subtitle="Each cell = the campaign's conversion at that stage. Orange = worse than all campaigns combined (dark: 20%+ worse); blue = 10%+ better. First three stages are anonymous event counts.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 pr-2">Campaign</th>
                {stages.map((k) => <th key={k} className="px-1 text-right">{STAGE_LABEL[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.campaigns.map((c) => (
                <tr key={c.campaign_id} className="border-t border-stone-100">
                  <td className="py-1.5 pr-2 font-medium">{c.campaign_name}</td>
                  {stages.map((k) => {
                    const v = c.rates[k];
                    const p = s.portfolio_rates[k];
                    const r = v != null && p ? v / p - 1 : null;
                    return (
                      <td key={k} className={`px-2 text-right tabular-nums ${cellColor(r)}`} title={r != null ? `${(r * 100).toFixed(0)}% vs average` : ""}>
                        {pct(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300 font-semibold">
                <td className="py-1.5 pr-2">All campaigns</td>
                {stages.map((k) => <td key={k} className="px-2 text-right tabular-nums">{pct(s.portfolio_rates[k])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Spend share vs attendee share" subtitle="A campaign whose spend bar is far taller than its attendee bar is buying attendees expensively.">
          {s.event.phase === "post_event" ? (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={share} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="Share of spend" fill="#94a3b8" />
                  <Bar isAnimationActive={false} dataKey="Share of attendees" fill="#1e3a8a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>Attendance is known only after the event. Move the date to after 13 April to compare.</Empty>
          )}
        </Card>

        <Card title="What predicts showing up?" subtitle="Share of registrants who attended, with vs without each action. This is correlation, not proof of cause.">
          {s.engagement_drivers ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5">Registrant…</th><th className="text-right">n</th><th className="text-right">Came (with)</th><th className="text-right">Came (without)</th><th className="text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {s.engagement_drivers.map((d) => (
                  <tr key={d.event_type} className="border-t border-stone-100">
                    <td className="py-1.5">{EVENT_LABEL[d.event_type] ?? d.event_type}</td>
                    <td className="text-right tabular-nums">{num(d.registrants_with)}</td>
                    <td className="text-right tabular-nums">{pct(d.show_rate_with)}</td>
                    <td className="text-right tabular-nums">{pct(d.show_rate_without)}</td>
                    <td className={`text-right font-semibold tabular-nums ${d.lift_pts != null && d.lift_pts >= 5 ? "text-blue-800" : d.lift_pts != null && d.lift_pts <= -5 ? "text-orange-700" : "text-slate-600"}`}>
                      {d.lift_pts == null ? "–" : `${d.lift_pts > 0 ? "+" : ""}${d.lift_pts} pts`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Needs attendance data, which exists only after the event.</Empty>
          )}
        </Card>
      </div>

      <Card title="Bottleneck per campaign" subtitle="The single stage where each campaign falls furthest below the all-campaign rate">
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          {s.campaigns.map((c) => (
            <li key={c.campaign_id} className="rounded-lg bg-stone-50 p-2">
              <b>{c.campaign_name}:</b>{" "}
              {c.bottleneck
                ? `${STAGE_LABEL[c.bottleneck.stage]} at ${pct(c.bottleneck.rate)} vs ${pct(c.bottleneck.portfolio_rate)} average (${pct(c.bottleneck.relative_gap, 0)}).`
                : "no stage below average."}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
