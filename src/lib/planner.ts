/**
 * Budget reallocation simulator. Same model as the strategy deck (Slide 1), but its
 * per-campaign economics come from the LIVE snapshot, so edited data changes the plan.
 *
 *   cost per registration at new spend = current cost per registration × max(1, new/current) ^ elasticity
 *   registrations = spend / cost per registration
 *   attendees     = registrations × the campaign's show rate (+ uplift, capped)
 *
 * Elasticity and uplift are ASSUMPTIONS (not in the data) and are shown as such.
 */
import type { Snapshot } from "./engine";

export interface PlanInput {
  allocation: Record<string, number>; // campaign_id -> spend in INR
  elasticity: number; // diminishing returns, 0 = none
  show_uplift_pts: number; // percentage points added to each show rate
  walkin_share: number; // walk-ins as share of all attendees
  max_show_rate: number;
}

export interface PlanRow {
  campaign_id: string;
  campaign_name: string;
  current_spend: number;
  new_spend: number;
  cost_per_registration: number | null;
  registrations: number;
  show_rate: number | null;
  attendees: number;
  cost_per_attendee: number | null;
  note: string | null;
}

export interface PlanResult {
  rows: PlanRow[];
  total_spend: number;
  registrations: number;
  registered_attendees: number;
  walk_ins: number;
  unique_attendees: number;
  cost_per_attendee: number | null;
  assumptions: string[];
  warnings: string[];
}

export function simulatePlan(s: Snapshot, input: PlanInput): PlanResult {
  const warnings: string[] = [];
  if (s.event.phase !== "post_event") {
    warnings.push("Show rates are only known after the event; this snapshot is before or during the event, so the plan uses the assumed show rate from Settings for every campaign.");
  }
  const fallbackShow = s.totals.show_rate ?? 0.69;
  const rows: PlanRow[] = s.campaigns.map((c) => {
    const newSpend = Math.max(0, input.allocation[c.campaign_id] ?? c.spend_inr);
    const base = c.cost_per_registration;
    let note: string | null = null;
    if (base == null || c.spend_inr <= 0 || c.registrations === 0) {
      note = "No spend or registrations recorded: cannot estimate cost, so this campaign is excluded.";
      return { campaign_id: c.campaign_id, campaign_name: c.campaign_name, current_spend: c.spend_inr, new_spend: newSpend, cost_per_registration: null, registrations: 0, show_rate: null, attendees: 0, cost_per_attendee: null, note };
    }
    const cpr = base * Math.pow(Math.max(1, newSpend / c.spend_inr), input.elasticity);
    const regs = newSpend / cpr;
    const show0 = c.rates.registered_to_attended ?? fallbackShow;
    const show = Math.min(input.max_show_rate, show0 + input.show_uplift_pts / 100);
    const att = regs * show;
    if (newSpend > c.spend_inr * 3) note = "More than 3× current spend: far outside observed data, low confidence.";
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      current_spend: c.spend_inr,
      new_spend: newSpend,
      cost_per_registration: Math.round(cpr),
      registrations: Math.round(regs),
      show_rate: Math.round(show * 1000) / 1000,
      attendees: Math.round(att),
      cost_per_attendee: att > 0 ? Math.round(newSpend / att) : null,
      note,
    };
  });
  const regs = rows.reduce((a, r) => a + r.registrations, 0);
  const regAtt = rows.reduce((a, r) => a + r.attendees, 0);
  const walk = Math.round((regAtt * input.walkin_share) / (1 - input.walkin_share));
  const total = rows.reduce((a, r) => a + r.new_spend, 0);
  const unique = regAtt + walk;
  if (s.targets && total > s.targets.marketing_budget_inr) {
    warnings.push(`Planned spend ₹${total.toLocaleString("en-IN")} exceeds the approved budget ₹${s.targets.marketing_budget_inr.toLocaleString("en-IN")}.`);
  }
  return {
    rows,
    total_spend: total,
    registrations: regs,
    registered_attendees: regAtt,
    walk_ins: walk,
    unique_attendees: unique,
    cost_per_attendee: unique > 0 ? Math.round(total / unique) : null,
    assumptions: [
      `Diminishing returns: cost per registration × (new ÷ current spend)^${input.elasticity} when spend rises [assumption].`,
      `Show rates are each campaign's actual rate${input.show_uplift_pts ? ` + ${input.show_uplift_pts} pts uplift [assumption]` : ""}, capped at ${(input.max_show_rate * 100).toFixed(0)}%.`,
      `Walk-ins are ${(input.walkin_share * 100).toFixed(0)}% of attendees [assumption; 2025 actual 6.1%].`,
      "Cutting spend keeps the current cost per registration (no efficiency gain assumed).",
    ],
    warnings,
  };
}
