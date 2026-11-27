import type { Plan2027State } from "./plan2027";

// Source tables: field names match the supplied dataset exactly.

export interface EventRow {
  event_name: string;
  history_start: string; // YYYY-MM-DD
  history_end: string;
  event_starts_at: string; // ISO with +05:30
  event_ends_at: string;
  timezone: string;
  currency: string;
  fictional: boolean;
}

export interface TargetRow {
  effective_at: string;
  identified_external_people_goal: number;
  registration_goal: number;
  unique_external_visitors_goal: number;
  marketing_budget_inr: number;
  target_version: string;
}

export interface CampaignRow {
  campaign_name: string;
  channel: string;
  target_audience: string;
  objective: string;
  owner_name: string;
  created_at: string;
  planned_start_at: string;
  planned_end_at: string;
  campaign_id: string;
  owner_id: string;
}

export interface DailyRow {
  campaign_name: string;
  owner_name: string;
  activity_date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  reported_reach: number;
  landing_page_sessions: number;
  registration_starts: number;
  marketing_spend_inr: number;
  platform: string;
  activity_id: string;
  campaign_id: string;
  owner_id: string;
}

export interface PersonRow {
  person_name: string;
  person_type: "external" | "internal" | "staff" | "test" | string;
  first_seen_at: string;
  first_touch_source: string;
  first_campaign_name: string | null;
  owner_name: string | null;
  person_id: string;
  first_campaign_id: string | null;
  owner_id: string | null;
}

export interface InteractionRow {
  person_name: string;
  campaign_name: string | null;
  owner_name: string | null;
  occurred_at: string;
  event_type: string;
  detail: string;
  interaction_id: string;
  person_id: string;
  campaign_id: string | null;
  owner_id: string | null;
}

export interface RegistrationRow {
  person_name: string;
  campaign_name: string | null;
  owner_name: string | null;
  registered_at: string;
  registration_id: string;
  person_id: string;
  campaign_id: string | null;
  owner_id: string | null;
}

export interface HistoryRow {
  person_name: string;
  campaign_name: string | null;
  owner_name: string | null;
  effective_at: string;
  status: "interested" | "confirmed" | "cancelled" | "waitlisted" | string;
  history_id: string;
  registration_id: string;
  person_id: string;
  campaign_id: string | null;
  owner_id: string | null;
}

export interface CheckinRow {
  person_name: string;
  campaign_name: string | null;
  owner_name: string | null;
  occurred_at: string;
  result: "admitted" | "denied" | "pending" | string;
  verification: "verified" | "unverified" | string;
  source: string;
  event_id: string;
  person_id: string;
  registration_id: string | null;
  campaign_id: string | null;
  owner_id: string | null;
}

export interface Dataset {
  event: EventRow[];
  targets: TargetRow[];
  campaigns: CampaignRow[];
  campaign_daily: DailyRow[];
  people: PersonRow[];
  interactions: InteractionRow[];
  registrations: RegistrationRow[];
  registration_history: HistoryRow[];
  checkins: CheckinRow[];
}

export const SOURCE_TABLES = [
  "event",
  "targets",
  "campaigns",
  "campaign_daily",
  "people",
  "interactions",
  "registrations",
  "registration_history",
  "checkins",
] as const;
export type SourceTable = (typeof SOURCE_TABLES)[number];

// ---- App-owned records (management layer) ----

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  campaign_id: string | null;
  owner_id: string | null;
  due_date: string | null; // YYYY-MM-DD
  status: TaskStatus;
  priority: TaskPriority;
  created_by: "user" | "copilot";
  created_at: string;
  updated_at: string;
}

export type PlanStatus = "active" | "scaling" | "paused" | "stopped";

export interface CampaignPlan {
  campaign_id: string;
  status: PlanStatus;
  planned_budget_inr: number | null;
  notes: string;
}

export interface DecisionRules {
  // After the event (attendance known): judged on cost per verified attendee and show rate.
  scale_max_cost_per_attendee: number;
  scale_min_show_rate: number;
  stop_min_cost_per_attendee: number;
  stop_max_show_rate: number;
  // Before the event: judged on cost per registration.
  scale_max_cost_per_registration: number;
  stop_min_cost_per_registration: number;
}

export interface Settings {
  rules: DecisionRules;
  assumed_show_rate: number; // used only for pre-event projections
  assumed_walkin_share: number; // walk-ins as a share of all attendees, pre-event projections
}

export interface AuditEntry {
  at: string;
  actor: "user" | "copilot";
  action: string;
  detail: string;
}

export interface AppState {
  tasks: Task[];
  plans: Record<string, CampaignPlan>;
  settings: Settings;
  audit: AuditEntry[];
  plan2027?: Plan2027State; // optional so app states saved before this field existed still load
}

export const DEFAULT_SETTINGS: Settings = {
  rules: {
    scale_max_cost_per_attendee: 100,
    scale_min_show_rate: 0.75,
    stop_min_cost_per_attendee: 200,
    stop_max_show_rate: 0.55,
    scale_max_cost_per_registration: 80,
    stop_min_cost_per_registration: 150,
  },
  assumed_show_rate: 0.69,
  assumed_walkin_share: 0.06,
};
