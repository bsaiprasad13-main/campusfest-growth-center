/**
 * Metrics engine. Every number in the dashboard and every answer from the copilot
 * comes from here, computed live from the stored source tables.
 *
 * Cleaning rules (from the dataset's own "Read me"):
 *  1. Exact repeated source IDs are import copies: keep one.
 *  2. Only person_type = "external" counts toward targets.
 *  3. An attendee is a DISTINCT external person with an admitted + verified check-in.
 *  4. Registration status = latest history version at or before the snapshot.
 *  5. A snapshot date means the end of that day in IST; nothing later may leak in.
 *  6. Summed reach / impressions are event counts, not unique people.
 */
import type {
  AppState,
  CampaignRow,
  CheckinRow,
  Dataset,
  DecisionRules,
  HistoryRow,
  RegistrationRow,
  TargetRow,
} from "./types";

// ---------- helpers ----------

export const endOfDayMs = (date: string) => Date.parse(`${date}T23:59:59.999+05:30`);
const ms = (iso: string) => Date.parse(iso);
export const istDate = (iso: string) =>
  new Date(ms(iso) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const round = (x: number | null, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function dedupe<T>(rows: T[], key: keyof T): { rows: T[]; removed: number } {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const r of rows) {
    const k = r[key];
    if (k == null || !seen.has(k)) {
      if (k != null) seen.add(k);
      out.push(r);
    }
  }
  return { rows: out, removed: rows.length - out.length };
}

export interface CleanResult {
  ds: Dataset;
  duplicatesRemoved: Record<string, number>;
}

export function clean(raw: Dataset): CleanResult {
  const d1 = dedupe(raw.campaign_daily, "activity_id");
  const d2 = dedupe(raw.registration_history, "history_id");
  const d3 = dedupe(raw.checkins, "event_id");
  const d4 = dedupe(raw.interactions, "interaction_id");
  const d5 = dedupe(raw.registrations, "registration_id");
  const d6 = dedupe(raw.people, "person_id");
  const d7 = dedupe(raw.campaigns, "campaign_id");
  return {
    ds: {
      ...raw,
      campaign_daily: d1.rows,
      registration_history: d2.rows,
      checkins: d3.rows,
      interactions: d4.rows,
      registrations: d5.rows,
      people: d6.rows,
      campaigns: d7.rows,
    },
    duplicatesRemoved: {
      campaign_daily: d1.removed,
      registration_history: d2.removed,
      checkins: d3.removed,
      interactions: d4.removed,
      registrations: d5.removed,
      people: d6.removed,
      campaigns: d7.removed,
    },
  };
}

export function targetsAt(targets: TargetRow[], asOfMs: number): TargetRow | null {
  const eligible = targets
    .filter((t) => ms(t.effective_at) <= asOfMs)
    .sort((a, b) => ms(a.effective_at) - ms(b.effective_at));
  return eligible.length ? eligible[eligible.length - 1] : null;
}

export function latestStatuses(history: HistoryRow[], asOfMs: number): Map<string, string> {
  const best = new Map<string, HistoryRow>();
  for (const h of history) {
    const t = ms(h.effective_at);
    if (t > asOfMs) continue;
    const cur = best.get(h.registration_id);
    if (!cur || t > ms(cur.effective_at) || (t === ms(cur.effective_at) && h.history_id > cur.history_id)) {
      best.set(h.registration_id, h);
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.status]));
}

export const isVerifiedAdmission = (c: CheckinRow) => c.result === "admitted" && c.verification === "verified";

// ---------- snapshot types ----------

export interface StageRates {
  ctr: number | null; // clicks / impressions (anonymous events)
  click_to_session: number | null; // sessions / clicks
  session_to_reg_start: number | null; // registration starts / sessions
  identified_to_registered: number | null; // registrations / identified people
  registered_to_confirmed: number | null; // currently confirmed / registrations
  registered_to_attended: number | null; // registered attendees / registrations (post-event only)
}

export interface Decision {
  status: "scale" | "change" | "stop" | "insufficient_data";
  basis: "cost_per_attendee" | "cost_per_registration" | "none";
  reasons: string[];
}

export interface CampaignMetrics {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  owner_id: string;
  owner_name: string;
  target_audience: string;
  objective: string;
  planned_start_at: string;
  planned_end_at: string;
  plan_status: string;
  planned_budget_inr: number | null;
  impressions: number;
  clicks: number;
  reported_reach_sum: number;
  landing_page_sessions: number;
  registration_starts: number;
  spend_inr: number;
  identified_people: number;
  registrations: number;
  status_counts: Record<string, number>;
  attendees: number; // distinct verified external attendees attributed to this campaign
  rates: StageRates;
  cost_per_identified: number | null;
  cost_per_registration: number | null;
  cost_per_attendee: number | null;
  budget_used_pct: number | null;
  share_of_spend: number | null;
  share_of_attendees: number | null;
  bottleneck: { stage: keyof StageRates; rate: number; portfolio_rate: number; relative_gap: number } | null;
  decision: Decision;
}

export interface Snapshot {
  as_of: string;
  as_of_end_ms: number;
  event: {
    name: string;
    starts_at: string;
    ends_at: string;
    phase: "pre_event" | "during_event" | "post_event";
    days_to_event: number;
    history_start: string;
    history_end: string;
  };
  targets: TargetRow | null;
  totals: {
    identified_people: number;
    identified_by_source: Record<string, number>;
    registrations: number;
    status_counts: Record<string, number>;
    unique_attendees: number;
    registered_attendees: number;
    walk_in_attendees: number;
    admissions_verified_events: number;
    attendees_by_day: Record<string, number>;
    attendees_both_days: number;
    spend_inr: number;
    impressions: number;
    clicks: number;
    landing_page_sessions: number;
    registration_starts: number;
    budget_inr: number | null;
    budget_remaining_inr: number | null;
    cost_per_attendee: number | null;
    cost_per_registration: number | null;
    show_rate: number | null; // registered attendees / registrations
    confirmed_show_rate: number | null; // attended / currently confirmed
    lost_registrations: { cancelled: number; waitlisted: number; interested_only: number; confirmed_no_show: number } | null;
  };
  progress: {
    identified_pct: number | null;
    registrations_pct: number | null;
    attendees_pct: number | null;
    budget_used_pct: number | null;
    linear_pace_registrations: number | null;
  };
  projection: {
    method: string;
    projected_registrations: number;
    projected_unique_attendees: number;
    assumptions: string[];
  };
  campaigns: CampaignMetrics[];
  portfolio_rates: StageRates;
  daily: DailyPoint[];
  engagement_drivers: EngagementDriver[] | null;
  data_quality: {
    duplicates_removed: Record<string, number>;
    excluded_non_external_admissions: number;
    denied_checkins: number;
    pending_or_unverified_checkins: number;
    vendor_credit_rows: number;
    unattributed_attendees: number;
  };
}

export interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  sessions: number;
  registrations: number;
  identified: number;
  cum_registrations: number;
  cum_identified: number;
  cum_spend: number;
  target_pace_registrations: number | null;
}

export interface EngagementDriver {
  event_type: string;
  registrants_with: number;
  show_rate_with: number | null;
  registrants_without: number;
  show_rate_without: number | null;
  lift_pts: number | null;
}

// ---------- decision rules ----------

export function decide(
  m: Pick<CampaignMetrics, "cost_per_attendee" | "cost_per_registration" | "rates" | "registrations">,
  phase: Snapshot["event"]["phase"],
  rules: DecisionRules,
): Decision {
  if (m.registrations < 20) {
    return { status: "insufficient_data", basis: "none", reasons: ["Fewer than 20 registrations: too little evidence to judge."] };
  }
  if (phase === "post_event" && m.cost_per_attendee != null && m.rates.registered_to_attended != null) {
    const c = m.cost_per_attendee;
    const s = m.rates.registered_to_attended;
    const reasons: string[] = [];
    if (c >= rules.stop_min_cost_per_attendee || s < rules.stop_max_show_rate) {
      if (c >= rules.stop_min_cost_per_attendee) reasons.push(`₹${Math.round(c)} per attendee ≥ stop line ₹${rules.stop_min_cost_per_attendee}`);
      if (s < rules.stop_max_show_rate) reasons.push(`show rate ${(s * 100).toFixed(1)}% < stop line ${(rules.stop_max_show_rate * 100).toFixed(0)}%`);
      return { status: "stop", basis: "cost_per_attendee", reasons };
    }
    if (c <= rules.scale_max_cost_per_attendee && s >= rules.scale_min_show_rate) {
      return {
        status: "scale",
        basis: "cost_per_attendee",
        reasons: [
          `₹${Math.round(c)} per attendee ≤ scale line ₹${rules.scale_max_cost_per_attendee}`,
          `show rate ${(s * 100).toFixed(1)}% ≥ scale line ${(rules.scale_min_show_rate * 100).toFixed(0)}%`,
        ],
      };
    }
    if (c > rules.scale_max_cost_per_attendee) reasons.push(`₹${Math.round(c)} per attendee is above the scale line ₹${rules.scale_max_cost_per_attendee}`);
    if (s < rules.scale_min_show_rate) reasons.push(`show rate ${(s * 100).toFixed(1)}% is below the scale line ${(rules.scale_min_show_rate * 100).toFixed(0)}%`);
    return { status: "change", basis: "cost_per_attendee", reasons };
  }
  if (m.cost_per_registration != null) {
    const c = m.cost_per_registration;
    if (c >= rules.stop_min_cost_per_registration)
      return { status: "stop", basis: "cost_per_registration", reasons: [`₹${Math.round(c)} per registration ≥ stop line ₹${rules.stop_min_cost_per_registration}`] };
    if (c <= rules.scale_max_cost_per_registration)
      return { status: "scale", basis: "cost_per_registration", reasons: [`₹${Math.round(c)} per registration ≤ scale line ₹${rules.scale_max_cost_per_registration}`] };
    return { status: "change", basis: "cost_per_registration", reasons: [`₹${Math.round(c)} per registration is between the scale and stop lines`] };
  }
  return { status: "insufficient_data", basis: "none", reasons: ["No spend recorded, so cost metrics cannot be judged."] };
}

// ---------- main snapshot ----------

export function computeSnapshot(raw: Dataset, app: AppState, asOf?: string): Snapshot {
  const { ds, duplicatesRemoved } = clean(raw);
  const ev = ds.event[0];
  const asOfDate = asOf ?? ev.history_end;
  const T = endOfDayMs(asOfDate);
  const eventStart = ms(ev.event_starts_at);
  const eventEnd = ms(ev.event_ends_at);
  const phase: Snapshot["event"]["phase"] = T < eventStart ? "pre_event" : T <= eventEnd ? "during_event" : "post_event";
  const daysToEvent = Math.ceil((eventStart - T) / 86400000);

  const personType = new Map(ds.people.map((p) => [p.person_id, p.person_type]));
  const isExternal = (pid: string) => personType.get(pid) === "external";

  // identified external people
  const people = ds.people.filter((p) => p.person_type === "external" && ms(p.first_seen_at) <= T);
  const identifiedBySource: Record<string, number> = {};
  for (const p of people) {
    const k = p.first_campaign_id ?? `(${p.first_touch_source})`;
    identifiedBySource[k] = (identifiedBySource[k] ?? 0) + 1;
  }

  // registrations (external, created by T). One person may hold one registration in this data;
  // we still count distinct persons for the registration goal.
  const regs: RegistrationRow[] = ds.registrations.filter((r) => isExternal(r.person_id) && ms(r.registered_at) <= T);
  const regByPerson = new Map<string, RegistrationRow>();
  for (const r of regs) if (!regByPerson.has(r.person_id)) regByPerson.set(r.person_id, r);
  const statuses = latestStatuses(ds.registration_history, T);
  const statusOf = (r: RegistrationRow) => statuses.get(r.registration_id) ?? "interested";

  // check-ins
  const checkinsToDate = ds.checkins.filter((c) => ms(c.occurred_at) <= T);
  const verifiedExt = checkinsToDate.filter((c) => isVerifiedAdmission(c) && isExternal(c.person_id));
  const attendeeIds = new Set(verifiedExt.map((c) => c.person_id));
  const byDay: Record<string, Set<string>> = {};
  for (const c of verifiedExt) (byDay[istDate(c.occurred_at)] ??= new Set()).add(c.person_id);
  const dayCount = new Map<string, number>();
  for (const s of Object.values(byDay)) for (const pid of s) dayCount.set(pid, (dayCount.get(pid) ?? 0) + 1);

  const registeredAttendees = [...regByPerson.keys()].filter((pid) => attendeeIds.has(pid)).length;
  const walkIns = attendeeIds.size - registeredAttendees;

  // attribution: registration's recorded acquisition source; else the person's first campaign
  const personCampaign = new Map(ds.people.map((p) => [p.person_id, p.first_campaign_id]));
  const attendeeCampaign = (pid: string) => regByPerson.get(pid)?.campaign_id ?? personCampaign.get(pid) ?? null;

  // marketing
  const daily = ds.campaign_daily.filter((d) => d.activity_date <= asOfDate);

  // per campaign
  const plans = app.plans;
  const totalSpend = daily.reduce((a, d) => a + d.marketing_spend_inr, 0);
  const campaignRows: CampaignRow[] = ds.campaigns;
  const statusCountsTotal: Record<string, number> = { interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0 };
  for (const r of regByPerson.values()) statusCountsTotal[statusOf(r)] = (statusCountsTotal[statusOf(r)] ?? 0) + 1;

  const postEvent = phase === "post_event";
  const attendeesByCampaign = new Map<string, number>();
  let unattributed = 0;
  for (const pid of attendeeIds) {
    const c = attendeeCampaign(pid);
    if (c) attendeesByCampaign.set(c, (attendeesByCampaign.get(c) ?? 0) + 1);
    else unattributed++;
  }

  const sumBy = (rows: typeof daily, f: (d: (typeof daily)[number]) => number) => rows.reduce((a, d) => a + f(d), 0);
  const ratesFor = (x: {
    impressions: number; clicks: number; sessions: number; regStarts: number; identified: number;
    registrations: number; confirmed: number; regAttended: number;
  }): StageRates => ({
    ctr: round(div(x.clicks, x.impressions)),
    click_to_session: round(div(x.sessions, x.clicks)),
    session_to_reg_start: round(div(x.regStarts, x.sessions)),
    identified_to_registered: round(div(x.registrations, x.identified)),
    registered_to_confirmed: round(div(x.confirmed, x.registrations)),
    registered_to_attended: postEvent ? round(div(x.regAttended, x.registrations)) : null,
  });

  const totalRegAttended = registeredAttendees;
  const portfolio_rates = ratesFor({
    impressions: sumBy(daily, (d) => d.impressions),
    clicks: sumBy(daily, (d) => d.clicks),
    sessions: sumBy(daily, (d) => d.landing_page_sessions),
    regStarts: sumBy(daily, (d) => d.registration_starts),
    identified: people.filter((p) => p.first_campaign_id).length,
    registrations: regByPerson.size,
    confirmed: statusCountsTotal.confirmed ?? 0,
    regAttended: totalRegAttended,
  });

  const campaigns: CampaignMetrics[] = campaignRows.map((c) => {
    const cd = daily.filter((d) => d.campaign_id === c.campaign_id);
    const cRegs = [...regByPerson.values()].filter((r) => r.campaign_id === c.campaign_id);
    const sc: Record<string, number> = { interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0 };
    for (const r of cRegs) sc[statusOf(r)] = (sc[statusOf(r)] ?? 0) + 1;
    const regAttended = cRegs.filter((r) => attendeeIds.has(r.person_id)).length;
    const identified = people.filter((p) => p.first_campaign_id === c.campaign_id).length;
    const spend = sumBy(cd, (d) => d.marketing_spend_inr);
    const attendees = attendeesByCampaign.get(c.campaign_id) ?? 0;
    const rates = ratesFor({
      impressions: sumBy(cd, (d) => d.impressions),
      clicks: sumBy(cd, (d) => d.clicks),
      sessions: sumBy(cd, (d) => d.landing_page_sessions),
      regStarts: sumBy(cd, (d) => d.registration_starts),
      identified,
      registrations: cRegs.length,
      confirmed: sc.confirmed ?? 0,
      regAttended,
    });
    // bottleneck: stage with the lowest ratio to the portfolio rate
    let bottleneck: CampaignMetrics["bottleneck"] = null;
    for (const k of Object.keys(rates) as (keyof StageRates)[]) {
      const r = rates[k];
      const p = portfolio_rates[k];
      if (r == null || p == null || p === 0) continue;
      const gap = r / p - 1;
      if (!bottleneck || gap < bottleneck.relative_gap) bottleneck = { stage: k, rate: r, portfolio_rate: p, relative_gap: round(gap)! };
    }
    if (bottleneck && bottleneck.relative_gap > -0.05) bottleneck = null; // within 5% of average is noise, not a bottleneck
    const plan = plans[c.campaign_id];
    const partial = {
      cost_per_attendee: postEvent ? round(div(spend, attendees), 2) : null,
      cost_per_registration: round(div(spend, cRegs.length), 2),
      rates,
      registrations: cRegs.length,
    };
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      channel: c.channel,
      owner_id: c.owner_id,
      owner_name: c.owner_name,
      target_audience: c.target_audience,
      objective: c.objective,
      planned_start_at: c.planned_start_at,
      planned_end_at: c.planned_end_at,
      plan_status: plan?.status ?? "active",
      planned_budget_inr: plan?.planned_budget_inr ?? null,
      impressions: sumBy(cd, (d) => d.impressions),
      clicks: sumBy(cd, (d) => d.clicks),
      reported_reach_sum: sumBy(cd, (d) => d.reported_reach),
      landing_page_sessions: sumBy(cd, (d) => d.landing_page_sessions),
      registration_starts: sumBy(cd, (d) => d.registration_starts),
      spend_inr: spend,
      identified_people: identified,
      registrations: cRegs.length,
      status_counts: sc,
      attendees,
      rates,
      cost_per_identified: round(div(spend, identified), 2),
      cost_per_registration: partial.cost_per_registration,
      cost_per_attendee: partial.cost_per_attendee,
      budget_used_pct: plan?.planned_budget_inr ? round(div(spend, plan.planned_budget_inr)) : null,
      share_of_spend: round(div(spend, totalSpend)),
      share_of_attendees: postEvent ? round(div(attendees, attendeeIds.size)) : null,
      bottleneck,
      decision: decide(partial, phase, app.settings.rules),
    };
  });

  const target = targetsAt(ds.targets, T);

  // daily series
  const dates = new Set<string>();
  for (const d of daily) dates.add(d.activity_date);
  for (const r of regByPerson.values()) dates.add(istDate(r.registered_at));
  for (const p of people) dates.add(istDate(p.first_seen_at));
  const sorted = [...dates].filter((d) => d <= asOfDate).sort();
  const regByDate = new Map<string, number>();
  for (const r of regByPerson.values()) regByDate.set(istDate(r.registered_at), (regByDate.get(istDate(r.registered_at)) ?? 0) + 1);
  const idByDate = new Map<string, number>();
  for (const p of people) idByDate.set(istDate(p.first_seen_at), (idByDate.get(istDate(p.first_seen_at)) ?? 0) + 1);
  const historyStartMs = endOfDayMs(ev.history_start) - 86400000;
  let cr = 0, ci = 0, cs = 0;
  const dailySeries: DailyPoint[] = sorted.map((date) => {
    const rows = daily.filter((d) => d.activity_date === date);
    const spend = sumBy(rows, (d) => d.marketing_spend_inr);
    const regsToday = regByDate.get(date) ?? 0;
    const idToday = idByDate.get(date) ?? 0;
    cr += regsToday; ci += idToday; cs += spend;
    const tAt = targetsAt(ds.targets, endOfDayMs(date));
    const frac = Math.min(1, Math.max(0, (endOfDayMs(date) - historyStartMs) / (eventStart - historyStartMs)));
    return {
      date, spend,
      impressions: sumBy(rows, (d) => d.impressions),
      clicks: sumBy(rows, (d) => d.clicks),
      sessions: sumBy(rows, (d) => d.landing_page_sessions),
      registrations: regsToday, identified: idToday,
      cum_registrations: cr, cum_identified: ci, cum_spend: cs,
      target_pace_registrations: tAt ? Math.round(tAt.registration_goal * frac) : null,
    };
  });

  // engagement drivers (only meaningful once attendance is known)
  let engagement_drivers: EngagementDriver[] | null = null;
  if (postEvent && regByPerson.size) {
    const types = ["brochure_download", "event_question_submitted", "nurture_email_opened", "nurture_email_clicked", "opted_out", "registration_start", "page_visit"];
    const byType = new Map<string, Set<string>>();
    for (const i of ds.interactions) {
      if (ms(i.occurred_at) > T) continue;
      (byType.get(i.event_type) ?? byType.set(i.event_type, new Set()).get(i.event_type)!).add(i.person_id);
    }
    const registrants = [...regByPerson.keys()];
    engagement_drivers = types.filter((t) => byType.has(t)).map((t) => {
      const set = byType.get(t)!;
      const w = registrants.filter((p) => set.has(p));
      const wo = registrants.filter((p) => !set.has(p));
      const sw = div(w.filter((p) => attendeeIds.has(p)).length, w.length);
      const swo = div(wo.filter((p) => attendeeIds.has(p)).length, wo.length);
      return {
        event_type: t,
        registrants_with: w.length,
        show_rate_with: round(sw),
        registrants_without: wo.length,
        show_rate_without: round(swo),
        lift_pts: sw != null && swo != null ? round((sw - swo) * 100, 1) : null,
      };
    });
  }

  // projection
  const settings = app.settings;
  let projection: Snapshot["projection"];
  if (phase === "pre_event") {
    const last14 = dailySeries.slice(-14).reduce((a, d) => a + d.registrations, 0) / Math.max(1, Math.min(14, dailySeries.length));
    const projRegs = Math.round(regByPerson.size + last14 * Math.max(0, daysToEvent));
    const regAtt = projRegs * settings.assumed_show_rate;
    const projAtt = Math.round(regAtt / (1 - settings.assumed_walkin_share));
    projection = {
      method: "run-rate",
      projected_registrations: projRegs,
      projected_unique_attendees: projAtt,
      assumptions: [
        `Registrations continue at the last-14-day average (${last14.toFixed(1)} per day) for ${daysToEvent} more days.`,
        `${(settings.assumed_show_rate * 100).toFixed(0)}% of registrants attend (assumption, editable in Plan & decide).`,
        `Walk-ins add ${(settings.assumed_walkin_share * 100).toFixed(0)}% of attendees (assumption, editable in Plan & decide).`,
      ],
    };
  } else {
    projection = {
      method: phase === "post_event" ? "actual" : "actual-so-far",
      projected_registrations: regByPerson.size,
      projected_unique_attendees: attendeeIds.size,
      assumptions: phase === "post_event" ? ["Event is over: figures are actuals, not projections."] : ["Event in progress: attendance so far."],
    };
  }

  const confirmed = statusCountsTotal.confirmed ?? 0;
  const confirmedAttended = [...regByPerson.values()].filter((r) => statusOf(r) === "confirmed" && attendeeIds.has(r.person_id)).length;
  const budget = target?.marketing_budget_inr ?? null;

  return {
    as_of: asOfDate,
    as_of_end_ms: T,
    event: {
      name: ev.event_name, starts_at: ev.event_starts_at, ends_at: ev.event_ends_at, phase,
      days_to_event: daysToEvent, history_start: ev.history_start, history_end: ev.history_end,
    },
    targets: target,
    totals: {
      identified_people: people.length,
      identified_by_source: identifiedBySource,
      registrations: regByPerson.size,
      status_counts: statusCountsTotal,
      unique_attendees: attendeeIds.size,
      registered_attendees: registeredAttendees,
      walk_in_attendees: walkIns,
      admissions_verified_events: verifiedExt.length,
      attendees_by_day: Object.fromEntries(Object.entries(byDay).sort().map(([d, s]) => [d, s.size])),
      attendees_both_days: [...dayCount.values()].filter((n) => n >= 2).length,
      spend_inr: totalSpend,
      impressions: sumBy(daily, (d) => d.impressions),
      clicks: sumBy(daily, (d) => d.clicks),
      landing_page_sessions: sumBy(daily, (d) => d.landing_page_sessions),
      registration_starts: sumBy(daily, (d) => d.registration_starts),
      budget_inr: budget,
      budget_remaining_inr: budget != null ? budget - totalSpend : null,
      cost_per_attendee: postEvent ? round(div(totalSpend, attendeeIds.size), 2) : null,
      cost_per_registration: round(div(totalSpend, regByPerson.size), 2),
      show_rate: postEvent ? round(div(registeredAttendees, regByPerson.size)) : null,
      confirmed_show_rate: postEvent ? round(div(confirmedAttended, confirmed)) : null,
      lost_registrations: postEvent
        ? {
            cancelled: statusCountsTotal.cancelled ?? 0,
            waitlisted: statusCountsTotal.waitlisted ?? 0,
            interested_only: statusCountsTotal.interested ?? 0,
            confirmed_no_show: confirmed - confirmedAttended,
          }
        : null,
    },
    progress: {
      identified_pct: target ? round(div(people.length, target.identified_external_people_goal)) : null,
      registrations_pct: target ? round(div(regByPerson.size, target.registration_goal)) : null,
      attendees_pct: target ? round(div(attendeeIds.size, target.unique_external_visitors_goal)) : null,
      budget_used_pct: budget ? round(div(totalSpend, budget)) : null,
      linear_pace_registrations: dailySeries.length ? dailySeries[dailySeries.length - 1].target_pace_registrations : null,
    },
    projection,
    campaigns,
    portfolio_rates,
    daily: dailySeries,
    engagement_drivers,
    data_quality: {
      duplicates_removed: duplicatesRemoved,
      excluded_non_external_admissions: new Set(checkinsToDate.filter((c) => isVerifiedAdmission(c) && !isExternal(c.person_id)).map((c) => c.person_id)).size,
      denied_checkins: checkinsToDate.filter((c) => c.result === "denied").length,
      pending_or_unverified_checkins: checkinsToDate.filter((c) => c.result === "pending" || c.verification !== "verified").length,
      vendor_credit_rows: daily.filter((d) => d.marketing_spend_inr < 0).length,
      unattributed_attendees: unattributed,
    },
  };
}
