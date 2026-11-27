/**
 * The 2027 plan from the strategy deck, inside the product: five ranked bets, each with a
 * weekly early signal and Slide 3's scale / change / stop thresholds, plus the registration
 * pace rule, an attendance forecast and the budget and venue-cap checks.
 *
 * Everything here is pure: state in, evaluation out. The state (readings, thresholds,
 * budget, cap) is stored with the app state and can be edited on the "2027 plan" page.
 * The shipped readings are a SIMULATED week-3 example, labelled as such in the UI.
 */

export type BetId = "B1" | "B2" | "B3" | "B4" | "B5";
export type BetLabel = "scale" | "change" | "stop" | "no_reading";

export interface BetDef {
  id: BetId;
  rank: number;
  score: number; // weighted 1–5 score from Slide 2
  name: string;
  campaign_name: string | null; // the 2025 channel this bet grows (for tasks and owners), if any
  owner_role: string;
  weeks: string;
  extra_attendees: { base: number; stretch: number }; // vs 2025, from the strategy model
  risk: string;
  signal: string;
  unit: string; // shown after the reading: "%", "pts", "per college", "per week"
  gate_week: number; // week by which a Stop reading triggers the stop action
  actions: { scale: string; change: string; stop: string };
  defaults: { budget_inr: number; scale_at: number; stop_below: number };
}

export const BETS: BetDef[] = [
  {
    id: "B1", rank: 1, score: 4.15, name: "Bring-Your-Crew referrals", campaign_name: "Student Referrals", owner_role: "Referral lead", weeks: "1–10",
    extra_attendees: { base: 377, stretch: 1117 }, risk: "Friends may not convert (our weakest assumption)",
    signal: "% of registrants whose crew pass gets ≥1 friend registered within 7 days", unit: "%", gate_week: 3,
    actions: { scale: "Move ₹20k from paid retargeting into crew rewards", change: "Richer reward: fast-lane entry, merch for crews of 3+", stop: "Move ₹40k to Bets 2 and 3; cut the stretch target by 580" },
    defaults: { budget_inr: 80000, scale_at: 15, stop_below: 8 },
  },
  {
    id: "B2", rank: 2, score: 4.05, name: "Show-up engine", campaign_name: null, owner_role: "Ops lead", weeks: "6–10",
    extra_attendees: { base: 0, stretch: 437 }, risk: "Reminder fatigue: 13% of emailed people opted out in 2025",
    signal: "RSVP-yes lift vs the 10% holdout that gets no reminders", unit: "pts", gate_week: 8,
    actions: { scale: "Add a reminder wave and shuttles", change: "Change timing; move email to WhatsApp", stop: "One reminder at 48h only" },
    defaults: { budget_inr: 60000, scale_at: 8, stop_below: 3 },
  },
  {
    id: "B3", rank: 3, score: 3.8, name: "College Squad Passes", campaign_name: "College Partnerships", owner_role: "Partnerships lead", weeks: "pilot 1–3, scale 4–9",
    extra_attendees: { base: 438, stretch: 610 }, risk: "Slow approvals; squads that register but don't come",
    signal: "Registrations per pilot college within 14 days", unit: "per college", gate_week: 3,
    actions: { scale: "Sign all ~40 colleges", change: "Pitch clubs event slots or fest credit", stop: "No new agreements; serve signed colleges" },
    defaults: { budget_inr: 110000, scale_at: 25, stop_below: 12 },
  },
  {
    id: "B4", rank: 4, score: 3.5, name: "Pay-per-attendee ambassadors", campaign_name: "Campus Ambassadors", owner_role: "Ambassador lead", weeks: "2–10",
    extra_attendees: { base: 226, stretch: 301 }, risk: "Motivation dips when paid only after the fest",
    signal: "Registrations per ambassador per week", unit: "per week", gate_week: 3,
    actions: { scale: "Recruit 20 more ambassadors", change: "Leaderboard and a small advance per registration", stop: "Drop the bottom half; move the money to Bet 3" },
    defaults: { budget_inr: 90000, scale_at: 2, stop_below: 1 },
  },
  {
    id: "B5", rank: 5, score: 2.7, name: "Walk-in capture + day-2 hook", campaign_name: null, owner_role: "Events lead", weeks: "4–10",
    extra_attendees: { base: 56, stretch: 355 }, risk: "Needs sponsor money; day 1 may pass the venue cap",
    signal: "Share of registrants planning to come on day 2 (weekly poll)", unit: "%", gate_week: 7,
    actions: { scale: "Promote day 2 hard", change: "Day-2 discount; move the headliner to day 2", stop: "Day passes only; staff the walk-in desk" },
    defaults: { budget_inr: 40000, scale_at: 40, stop_below: 25 },
  },
];

/** Spend outside the five bets (Slide 2's last row): always-on organic + community, and capped paid ads. */
export const OTHER_LINES = [
  { name: "Always-on: organic search + community groups", budget_inr: 60000 },
  { name: "Paid ads, capped (retargeting + performance creators)", budget_inr: 60000 },
];

/** Share of all registrations that 2025 had by the end of each campaign week (week 10 = fest week) [data]. */
export const PACE_CURVE: [number, number][] = [[0, 0], [3, 0.3], [5, 0.46], [7, 0.65], [9, 0.9], [10, 1]];

/** Fixed planning assumptions from the strategy model (base case), shown in the UI. */
export const PLAN_ASSUMPTIONS = {
  show_rate: 0.77, // base-case share of registrants who come [model]
  walkin_share: 0.06, // walk-ins as a share of attendees [2025 data]
  day1_share: 0.7, // share of unique attendees present on day 1 [2025 data]
  visits_per_person: 1.35, // 35% of 2025 attendees came on both days [2025 data]
  day1_alert_share: 0.9, // alert when the day-1 forecast passes 90% of the cap (3,600 of 4,000)
};

export interface BetState { reading: number | null; scale_at: number; stop_below: number; budget_inr: number }

export interface Plan2027State {
  budget_inr: number;
  cap_per_day: number;
  plan_registrations: number;
  week: number | null; // current campaign week, 1–10
  registrations_to_date: number | null;
  bets: Record<BetId, BetState>;
  simulated: boolean; // true while the shipped example readings are in place
  updated_at: string | null;
}

export function defaultPlan2027(): Plan2027State {
  const bets = Object.fromEntries(BETS.map((b) => [b.id, { reading: null, ...b.defaults }])) as Record<BetId, BetState>;
  // Simulated week-3 readings so the page demonstrates each label out of the box.
  bets.B1.reading = 12;
  bets.B3.reading = 27;
  bets.B4.reading = 0.8;
  return { budget_inr: 500000, cap_per_day: 4000, plan_registrations: 3700, week: 3, registrations_to_date: 980, bets, simulated: true, updated_at: null };
}

export function curveShare(week: number): number {
  const w = Math.max(0, Math.min(10, week));
  for (let i = 1; i < PACE_CURVE.length; i++) {
    const [w0, s0] = PACE_CURVE[i - 1];
    const [w1, s1] = PACE_CURVE[i];
    if (w <= w1) return s0 + ((s1 - s0) * (w - w0)) / (w1 - w0);
  }
  return 1;
}

export function labelFor(reading: number | null, scaleAt: number, stopBelow: number): BetLabel {
  if (reading == null || !Number.isFinite(reading)) return "no_reading";
  if (reading >= scaleAt) return "scale";
  if (reading < stopBelow) return "stop";
  return "change";
}

export interface BetEval {
  id: BetId;
  rank: number;
  score: number;
  name: string;
  campaign_name: string | null;
  owner_role: string;
  weeks: string;
  extra_attendees: { base: number; stretch: number };
  risk: string;
  signal: string;
  unit: string;
  reading: number | null;
  scale_at: number;
  stop_below: number;
  budget_inr: number;
  label: BetLabel;
  action: string | null;
  reason: string;
  gate_week: number;
  before_gate: boolean; // a stop reading before the gate week is an early warning, not yet a stop
}

export interface PlanEval {
  simulated: boolean;
  updated_at: string | null;
  week: number | null;
  bets: BetEval[];
  counts: Record<BetLabel, number>;
  budget: { total_inr: number; allocated_inr: number; bets_inr: number; other_lines: typeof OTHER_LINES; gap_inr: number; status: "over" | "under" | "balanced"; advice: string };
  pace: null | { week: number; registrations_to_date: number; expected: number; ratio: number; status: "behind" | "on_track" | "ahead"; advice: string; checkpoints: { week: number; expected: number }[] };
  forecast: null | { registrations: number; registered_attendees: number; walk_ins: number; unique_attendees: number; day1_peak: number; cap_per_day: number; day1_alert_at: number; day1_status: "ok" | "near_cap" | "over_cap"; advice: string };
  ceiling: number;
  assumptions: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmtInr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function evaluatePlan(p: Plan2027State): PlanEval {
  const week = p.week != null && p.week >= 1 ? Math.min(10, Math.round(p.week)) : null;
  const bets: BetEval[] = BETS.map((d) => {
    const b = p.bets[d.id] ?? { reading: null, ...d.defaults };
    const label = labelFor(b.reading, b.scale_at, b.stop_below);
    const before = label === "stop" && week != null && week < d.gate_week;
    const shown = `${b.reading}${d.unit === "%" ? "%" : d.unit === "pts" ? " pts" : ` ${d.unit}`}`;
    const reason =
      label === "no_reading" ? `No reading yet (decision gate: week ${d.gate_week}).`
      : label === "scale" ? `${shown} ≥ scale line ${b.scale_at}.`
      : label === "stop" ? `${shown} < stop line ${b.stop_below}${before ? ` (early warning: the stop gate is week ${d.gate_week})` : ""}.`
      : `${shown} is between the stop line ${b.stop_below} and the scale line ${b.scale_at}.`;
    return {
      id: d.id, rank: d.rank, score: d.score, name: d.name, campaign_name: d.campaign_name, owner_role: d.owner_role, weeks: d.weeks,
      extra_attendees: d.extra_attendees, risk: d.risk, signal: d.signal, unit: d.unit,
      reading: b.reading, scale_at: b.scale_at, stop_below: b.stop_below, budget_inr: b.budget_inr,
      label, action: label === "no_reading" ? null : d.actions[label], reason, gate_week: d.gate_week, before_gate: before,
    };
  });
  const counts = { scale: 0, change: 0, stop: 0, no_reading: 0 } as Record<BetLabel, number>;
  for (const b of bets) counts[b.label]++;

  // Budget: bets + the other fixed lines vs the total budget.
  const betsInr = bets.reduce((a, b) => a + b.budget_inr, 0);
  const allocated = betsInr + OTHER_LINES.reduce((a, l) => a + l.budget_inr, 0);
  const gap = p.budget_inr - allocated;
  const lowest = [...bets].sort((a, b) => b.rank - a.rank)[0];
  const bestScale = bets.filter((b) => b.label === "scale").sort((a, b) => a.rank - b.rank)[0];
  const budget = {
    total_inr: p.budget_inr, allocated_inr: allocated, bets_inr: betsInr, other_lines: OTHER_LINES, gap_inr: gap,
    status: (gap < 0 ? "over" : gap > 0 ? "under" : "balanced") as "over" | "under" | "balanced",
    advice:
      gap < 0 ? `Over budget by ${fmtInr(-gap)}. Cut the lowest-ranked bet first (Bet ${lowest.rank}: ${lowest.name}), then the next one up.`
      : gap > 0 ? `${fmtInr(gap)} unallocated. Add it to ${bestScale ? `the top Scale bet (Bet ${bestScale.rank}: ${bestScale.name})` : "the highest-ranked bet once one reaches its scale line"}.`
      : "Allocation matches the budget.",
  };

  // Pace vs the 2025 registration curve.
  let pace: PlanEval["pace"] = null;
  let forecast: PlanEval["forecast"] = null;
  const checkpoints = [3, 5, 7, 9].map((w) => ({ week: w, expected: Math.round(p.plan_registrations * curveShare(w)) }));
  if (week != null && p.registrations_to_date != null && p.registrations_to_date >= 0) {
    const expected = Math.round(p.plan_registrations * curveShare(week));
    const ratio = expected > 0 ? p.registrations_to_date / expected : 0;
    const status = ratio < 0.85 ? "behind" : ratio > 1.1 ? "ahead" : "on_track";
    pace = {
      week, registrations_to_date: p.registrations_to_date, expected, ratio: Math.round(ratio * 1000) / 1000, status, checkpoints,
      advice:
        status === "behind" ? "Below 85% of the curve: reallocate money from Stop bets to Scale bets this week."
        : status === "ahead" ? "Above 110% of the curve: check the day-1 forecast against the venue cap."
        : "Within 85–110% of the curve: stay the course.",
    };
    const regs = p.registrations_to_date / curveShare(week);
    const regAtt = regs * PLAN_ASSUMPTIONS.show_rate;
    const unique = regAtt / (1 - PLAN_ASSUMPTIONS.walkin_share);
    const day1 = unique * PLAN_ASSUMPTIONS.day1_share;
    const alertAt = p.cap_per_day * PLAN_ASSUMPTIONS.day1_alert_share;
    const day1Status = day1 > p.cap_per_day ? "over_cap" : day1 > alertAt ? "near_cap" : "ok";
    forecast = {
      registrations: Math.round(regs), registered_attendees: Math.round(regAtt), walk_ins: Math.round(unique - regAtt), unique_attendees: Math.round(unique),
      day1_peak: Math.round(day1), cap_per_day: p.cap_per_day, day1_alert_at: Math.round(alertAt), day1_status: day1Status,
      advice: day1Status === "ok" ? `Day-1 forecast ${fmt(day1)} is below ${fmt(alertAt)} (90% of the cap).` : `Day-1 forecast ${fmt(day1)} is above ${fmt(alertAt)}: sell day-specific passes and promote day 2.`,
    };
  }

  return {
    simulated: p.simulated,
    updated_at: p.updated_at,
    week,
    bets,
    counts,
    budget,
    pace,
    forecast,
    ceiling: Math.round((p.cap_per_day * 2) / PLAN_ASSUMPTIONS.visits_per_person),
    assumptions: [
      "Pace curve: 2025 had 30 / 46 / 65 / 90% of its registrations by weeks 3 / 5 / 7 / 9 (week 10 = fest) [data].",
      `Forecast = registrations so far ÷ that week's curve share × ${PLAN_ASSUMPTIONS.show_rate * 100}% who come [base-case model] ÷ (1 − ${PLAN_ASSUMPTIONS.walkin_share * 100}% walk-ins [2025 data]).`,
      `Day-1 peak = ${PLAN_ASSUMPTIONS.day1_share * 100}% of unique attendees (2025 day-1 share) [data]. Ceiling = cap × 2 ÷ ${PLAN_ASSUMPTIONS.visits_per_person} visits per person [data].`,
      "Scale line = the model's assumption for that bet holds; stop line ≈ half of it [assumption].",
    ],
  };
}

/** Validate and merge a partial update. Throws Error with a readable message on bad input. */
export function applyPlanPatch(cur: Plan2027State, patch: Record<string, unknown>): Plan2027State {
  const next: Plan2027State = structuredClone(cur);
  const num = (v: unknown, name: string, min: number, max: number, allowNull = false): number | null => {
    if (v === null || v === "") {
      if (allowNull) return null;
      throw new Error(`${name} is required.`);
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}.`);
    return n;
  };
  if ("budget_inr" in patch) next.budget_inr = num(patch.budget_inr, "Budget", 0, 1e9)!;
  if ("cap_per_day" in patch) next.cap_per_day = num(patch.cap_per_day, "Venue cap per day", 1, 1e7)!;
  if ("plan_registrations" in patch) next.plan_registrations = num(patch.plan_registrations, "Planned registrations", 1, 1e8)!;
  if ("week" in patch) next.week = num(patch.week, "Campaign week", 1, 10, true);
  if ("registrations_to_date" in patch) next.registrations_to_date = num(patch.registrations_to_date, "Registrations to date", 0, 1e8, true);
  if (patch.bets && typeof patch.bets === "object") {
    for (const [id, raw] of Object.entries(patch.bets as Record<string, unknown>)) {
      const def = BETS.find((b) => b.id === id);
      if (!def) throw new Error(`Unknown bet ${id}.`);
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const b = next.bets[def.id];
      const label = `Bet ${def.rank}`;
      if ("reading" in r) b.reading = num(r.reading, `${label} reading`, 0, 1e6, true);
      if ("scale_at" in r) b.scale_at = num(r.scale_at, `${label} scale line`, 0, 1e6)!;
      if ("stop_below" in r) b.stop_below = num(r.stop_below, `${label} stop line`, 0, 1e6)!;
      if ("budget_inr" in r) b.budget_inr = num(r.budget_inr, `${label} budget`, 0, 1e9)!;
      if (b.stop_below > b.scale_at) throw new Error(`${label}: the stop line must not be above the scale line.`);
    }
  }
  next.simulated = false;
  next.updated_at = new Date().toISOString();
  return next;
}
