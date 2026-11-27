/**
 * Every write goes through here (used by the REST routes and by the copilot after the
 * user confirms). Each write validates input and appends an audit entry.
 */
import { getApp, getDataset, saveApp, saveTable, withLock, resetAll } from "./store";
import { applyPlanPatch, defaultPlan2027, type Plan2027State } from "./plan2027";
import type { AppState, CampaignRow, DailyRow, PlanStatus, Settings, TargetRow, Task, TaskPriority, TaskStatus } from "./types";

export class InputError extends Error {}

const nowIso = () => new Date().toISOString();
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const TASK_STATUS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITY: TaskPriority[] = ["high", "medium", "low"];
const PLAN_STATUS: PlanStatus[] = ["active", "scaling", "paused", "stopped"];

function audit(app: AppState, actor: "user" | "copilot", action: string, detail: string) {
  app.audit.unshift({ at: nowIso(), actor, action, detail });
  app.audit = app.audit.slice(0, 200);
}

// ---------------- tasks ----------------

export interface TaskInput {
  title?: string;
  description?: string;
  campaign_id?: string | null;
  owner_id?: string | null;
  due_date?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
}

async function validateTask(t: TaskInput) {
  if (t.status && !TASK_STATUS.includes(t.status)) throw new InputError(`status must be one of ${TASK_STATUS.join(", ")}`);
  if (t.priority && !PRIORITY.includes(t.priority)) throw new InputError(`priority must be one of ${PRIORITY.join(", ")}`);
  if (t.due_date != null && t.due_date !== "" && !isDate(t.due_date)) throw new InputError("due_date must be YYYY-MM-DD");
  const ds = await getDataset();
  if (t.campaign_id && !ds.campaigns.some((c) => c.campaign_id === t.campaign_id)) throw new InputError(`Unknown campaign_id ${t.campaign_id}`);
  if (t.owner_id && !listOwners(ds.campaigns).some((o) => o.owner_id === t.owner_id)) throw new InputError(`Unknown owner_id ${t.owner_id}`);
}

export function listOwners(campaigns: CampaignRow[]) {
  const m = new Map<string, string>();
  for (const c of campaigns) m.set(c.owner_id, c.owner_name);
  return [...m].map(([owner_id, owner_name]) => ({ owner_id, owner_name })).sort((a, b) => a.owner_id.localeCompare(b.owner_id));
}

export function createTask(input: TaskInput, actor: "user" | "copilot" = "user"): Promise<Task> {
  return withLock(async () => {
    if (!input.title || !input.title.trim()) throw new InputError("title is required");
    await validateTask(input);
    const app = await getApp();
    const task: Task = {
      id: `TK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      campaign_id: input.campaign_id || null,
      owner_id: input.owner_id || null,
      due_date: input.due_date || null,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      created_by: actor,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    app.tasks.unshift(task);
    audit(app, actor, "task.create", `${task.id}: ${task.title}`);
    await saveApp(app);
    return task;
  });
}

export function updateTask(id: string, patch: TaskInput, actor: "user" | "copilot" = "user"): Promise<Task> {
  return withLock(async () => {
    await validateTask(patch);
    const app = await getApp();
    const t = app.tasks.find((x) => x.id === id);
    if (!t) throw new InputError(`Task ${id} not found`);
    const allowed: (keyof TaskInput)[] = ["title", "description", "campaign_id", "owner_id", "due_date", "status", "priority"];
    for (const k of allowed) if (k in patch) (t as unknown as Record<string, unknown>)[k] = patch[k] === "" ? null : patch[k];
    t.updated_at = nowIso();
    audit(app, actor, "task.update", `${id}: ${Object.keys(patch).join(", ")}`);
    await saveApp(app);
    return t;
  });
}

export function deleteTask(id: string): Promise<void> {
  return withLock(async () => {
    const app = await getApp();
    const before = app.tasks.length;
    app.tasks = app.tasks.filter((t) => t.id !== id);
    if (app.tasks.length === before) throw new InputError(`Task ${id} not found`);
    audit(app, "user", "task.delete", id);
    await saveApp(app);
  });
}

// ---------------- campaigns ----------------

export interface CampaignPatch {
  campaign_name?: string;
  channel?: string;
  target_audience?: string;
  objective?: string;
  owner_id?: string;
  planned_start_at?: string;
  planned_end_at?: string;
  plan_status?: PlanStatus;
  planned_budget_inr?: number | null;
  notes?: string;
}

export function updateCampaign(id: string, p: CampaignPatch, actor: "user" | "copilot" = "user") {
  return withLock(async () => {
    const ds = await getDataset();
    const app = await getApp();
    const campaigns = structuredClone(ds.campaigns);
    const c = campaigns.find((x) => x.campaign_id === id);
    if (!c) throw new InputError(`Campaign ${id} not found`);
    if (p.plan_status && !PLAN_STATUS.includes(p.plan_status)) throw new InputError(`plan_status must be one of ${PLAN_STATUS.join(", ")}`);
    if (p.planned_budget_inr != null && (!Number.isFinite(p.planned_budget_inr) || p.planned_budget_inr < 0)) throw new InputError("planned_budget_inr must be a non-negative number");
    let tableChanged = false;
    for (const k of ["campaign_name", "channel", "target_audience", "objective", "planned_start_at", "planned_end_at"] as const) {
      if (p[k] != null && p[k] !== c[k]) { c[k] = String(p[k]); tableChanged = true; }
    }
    if (p.owner_id && p.owner_id !== c.owner_id) {
      const owner = listOwners(ds.campaigns).find((o) => o.owner_id === p.owner_id);
      if (!owner) throw new InputError(`Unknown owner_id ${p.owner_id}`);
      c.owner_id = owner.owner_id; c.owner_name = owner.owner_name; tableChanged = true;
    }
    if (tableChanged) await saveTable("campaigns", campaigns);
    const plan = (app.plans[id] ??= { campaign_id: id, status: "active", planned_budget_inr: null, notes: "" });
    if (p.plan_status) plan.status = p.plan_status;
    if ("planned_budget_inr" in p) plan.planned_budget_inr = p.planned_budget_inr ?? null;
    if (p.notes != null) plan.notes = p.notes;
    audit(app, actor, "campaign.update", `${id}: ${Object.keys(p).join(", ")}`);
    await saveApp(app);
    return { campaign: c, plan };
  });
}

export function createCampaign(input: Partial<CampaignRow> & { campaign_name: string; channel: string; owner_id: string }) {
  return withLock(async () => {
    const ds = await getDataset();
    const app = await getApp();
    if (!input.campaign_name?.trim()) throw new InputError("campaign_name is required");
    const owner = listOwners(ds.campaigns).find((o) => o.owner_id === input.owner_id);
    if (!owner) throw new InputError(`Unknown owner_id ${input.owner_id}`);
    const n = Math.max(0, ...ds.campaigns.map((c) => parseInt(c.campaign_id.replace(/\D/g, ""), 10) || 0)) + 1;
    const id = `C${String(n).padStart(2, "0")}`;
    const now = new Date().toISOString().slice(0, 19) + "+05:30";
    const row: CampaignRow = {
      campaign_name: input.campaign_name.trim(),
      channel: input.channel || "other",
      target_audience: input.target_audience ?? "",
      objective: input.objective ?? "",
      owner_name: owner.owner_name,
      created_at: now,
      planned_start_at: input.planned_start_at ?? now,
      planned_end_at: input.planned_end_at ?? ds.event[0].event_ends_at,
      campaign_id: id,
      owner_id: owner.owner_id,
    };
    await saveTable("campaigns", [...ds.campaigns, row]);
    app.plans[id] = { campaign_id: id, status: "active", planned_budget_inr: null, notes: "" };
    audit(app, "user", "campaign.create", `${id}: ${row.campaign_name}`);
    await saveApp(app);
    return row;
  });
}

// ---------------- daily marketing rows ----------------

const NUM_FIELDS = ["impressions", "clicks", "reported_reach", "landing_page_sessions", "registration_starts", "marketing_spend_inr"] as const;
export type DailyInput = Partial<Pick<DailyRow, (typeof NUM_FIELDS)[number] | "activity_date" | "campaign_id" | "platform">>;

export function upsertDaily(input: DailyInput & { activity_id?: string }) {
  return withLock(async () => {
    const ds = await getDataset();
    const app = await getApp();
    const rows = structuredClone(ds.campaign_daily);
    for (const f of NUM_FIELDS) {
      if (f in input) {
        const v = Number(input[f]);
        if (!Number.isFinite(v) || !Number.isInteger(v)) throw new InputError(`${f} must be a whole number`);
        if (f !== "marketing_spend_inr" && v < 0) throw new InputError(`${f} cannot be negative`);
      }
    }
    let row: DailyRow | undefined;
    if (input.activity_id) {
      const matches = rows.filter((r) => r.activity_id === input.activity_id);
      if (!matches.length) throw new InputError(`Row ${input.activity_id} not found`);
      for (const r of matches) for (const f of NUM_FIELDS) if (f in input) r[f] = Number(input[f]);
      row = matches[0];
      audit(app, "user", "daily.update", `${input.activity_id}: ${NUM_FIELDS.filter((f) => f in input).join(", ")}`);
    } else {
      const c = ds.campaigns.find((x) => x.campaign_id === input.campaign_id);
      if (!c) throw new InputError("A valid campaign_id is required");
      if (!isDate(input.activity_date)) throw new InputError("activity_date must be YYYY-MM-DD");
      const base = `MAN-${c.campaign_id}-${input.activity_date!.replace(/-/g, "")}`;
      let id = base, i = 2;
      while (rows.some((r) => r.activity_id === id)) id = `${base}-${i++}`;
      row = {
        campaign_name: c.campaign_name, owner_name: c.owner_name, activity_date: input.activity_date!,
        impressions: 0, clicks: 0, reported_reach: 0, landing_page_sessions: 0, registration_starts: 0, marketing_spend_inr: 0,
        platform: input.platform ?? "manual entry", activity_id: id, campaign_id: c.campaign_id, owner_id: c.owner_id,
      };
      for (const f of NUM_FIELDS) if (f in input) row[f] = Number(input[f]);
      rows.push(row);
      audit(app, "user", "daily.create", `${id}`);
    }
    await saveTable("campaign_daily", rows);
    await saveApp(app);
    return row;
  });
}

export function deleteDaily(activity_id: string) {
  return withLock(async () => {
    const ds = await getDataset();
    const app = await getApp();
    const rows = ds.campaign_daily.filter((r) => r.activity_id !== activity_id);
    if (rows.length === ds.campaign_daily.length) throw new InputError(`Row ${activity_id} not found`);
    await saveTable("campaign_daily", rows);
    audit(app, "user", "daily.delete", activity_id);
    await saveApp(app);
  });
}

// ---------------- targets ----------------

export function addTargetVersion(input: Omit<TargetRow, "effective_at"> & { effective_date: string }) {
  return withLock(async () => {
    const ds = await getDataset();
    const app = await getApp();
    if (!isDate(input.effective_date)) throw new InputError("effective_date must be YYYY-MM-DD");
    for (const k of ["identified_external_people_goal", "registration_goal", "unique_external_visitors_goal", "marketing_budget_inr"] as const) {
      const v = Number(input[k]);
      if (!Number.isFinite(v) || v < 0) throw new InputError(`${k} must be a non-negative number`);
    }
    const row: TargetRow = {
      effective_at: `${input.effective_date}T00:00:00+05:30`,
      identified_external_people_goal: Number(input.identified_external_people_goal),
      registration_goal: Number(input.registration_goal),
      unique_external_visitors_goal: Number(input.unique_external_visitors_goal),
      marketing_budget_inr: Number(input.marketing_budget_inr),
      target_version: input.target_version?.trim() || `Version from ${input.effective_date}`,
    };
    await saveTable("targets", [...ds.targets, row]);
    audit(app, "user", "targets.add", `${row.target_version} effective ${input.effective_date}`);
    await saveApp(app);
    return row;
  });
}

// ---------------- settings / reset ----------------

export function updateSettings(patch: Partial<Settings> & { rules?: Partial<Settings["rules"]> }) {
  return withLock(async () => {
    const app = await getApp();
    const next: Settings = { ...app.settings, ...patch, rules: { ...app.settings.rules, ...(patch.rules ?? {}) } };
    for (const [k, v] of Object.entries(next.rules)) if (!Number.isFinite(v) || v < 0) throw new InputError(`${k} must be a non-negative number`);
    if (next.assumed_show_rate <= 0 || next.assumed_show_rate > 1) throw new InputError("assumed_show_rate must be between 0 and 1");
    if (next.assumed_walkin_share < 0 || next.assumed_walkin_share >= 1) throw new InputError("assumed_walkin_share must be between 0 and 1");
    app.settings = next;
    audit(app, "user", "settings.update", Object.keys(patch).join(", "));
    await saveApp(app);
    return next;
  });
}

// ---------------- 2027 plan ----------------

export function updatePlan2027(patch: Record<string, unknown>, actor: "user" | "copilot" = "user"): Promise<Plan2027State> {
  return withLock(async () => {
    const app = await getApp();
    let next: Plan2027State;
    try {
      next = applyPlanPatch(app.plan2027 ?? defaultPlan2027(), patch);
    } catch (e) {
      throw new InputError(e instanceof Error ? e.message : String(e));
    }
    app.plan2027 = next;
    const what = Object.keys(patch).map((k) => (k === "bets" && patch.bets && typeof patch.bets === "object" ? `bets ${Object.keys(patch.bets).join("/")}` : k)).join(", ");
    audit(app, actor, "plan2027.update", what);
    await saveApp(app);
    return next;
  });
}

export function resetData() {
  return withLock(async () => {
    await resetAll();
  });
}
