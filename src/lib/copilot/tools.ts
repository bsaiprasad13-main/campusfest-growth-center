/**
 * Copilot tools. Every tool reads the live stored data through the same engine as the
 * dashboard, so answers change when the data changes. Write actions are only PROPOSED here;
 * the user confirms them in the UI, which then calls the normal REST endpoints.
 */
import { clean, endOfDayMs, istDate, latestStatuses, isVerifiedAdmission } from "../engine";
import { simulatePlan } from "../planner";
import type { LoadedState } from "../state";
import { calculate } from "./calc";

export interface Proposal {
  id: string;
  kind: "create_task" | "update_campaign";
  summary: string;
  payload: Record<string, unknown>;
  target_id?: string;
}

export interface ToolCtx {
  load: (asOf?: string) => Promise<LoadedState>;
  defaultAsOf: string;
  proposals: Proposal[];
}

type Args = Record<string, unknown>;
const r2 = (x: number | null | undefined, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const asOfArg = (a: Args, ctx: ToolCtx) => (typeof a.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.as_of) ? a.as_of : ctx.defaultAsOf);

function findCampaign(st: LoadedState, q: unknown) {
  if (typeof q !== "string" || !q.trim()) return null;
  const s = q.trim().toLowerCase();
  const cs = st.snapshot.campaigns;
  return (
    cs.find((c) => c.campaign_id.toLowerCase() === s) ??
    cs.find((c) => c.campaign_name.toLowerCase() === s) ??
    cs.find((c) => c.campaign_name.toLowerCase().includes(s) || c.channel.toLowerCase() === s) ??
    null
  );
}
function findOwner(st: LoadedState, q: unknown) {
  if (typeof q !== "string" || !q.trim()) return null;
  const s = q.trim().toLowerCase();
  return st.owners.find((o) => o.owner_id.toLowerCase() === s || o.owner_name.toLowerCase().includes(s)) ?? null;
}

// ---------------- declarations (Gemini function-calling schema) ----------------

const S = (description: string) => ({ type: "STRING", description });
const N = (description: string) => ({ type: "NUMBER", description });
const AS_OF = S("YYYY-MM-DD; omit for the app's selected date");

export const TOOL_DECLARATIONS = [
  { name: "get_data_dictionary", description: "Tables, fields, counting rules, campaigns, owners, and what is NOT in the data.", parameters: { type: "OBJECT", properties: {} } },
  { name: "get_overview", description: "Totals, targets, progress, budget, projection, lost registrations, data quality.", parameters: { type: "OBJECT", properties: { as_of: AS_OF } } },
  {
    name: "get_campaigns",
    description: "Per-campaign funnel, costs, rates, bottleneck and the official scale/change/stop decision (team rules). One campaign adds raw counts, plan and tasks.",
    parameters: { type: "OBJECT", properties: { as_of: AS_OF, campaign: S("name or ID; omit for all") } },
  },
  { name: "get_diagnostics", description: "Stage rates vs average, spend vs attendee share, engagement actions linked to attendance, lost registrations.", parameters: { type: "OBJECT", properties: { as_of: AS_OF } } },
  {
    name: "get_timeseries",
    description: "Daily/weekly series of one metric.",
    parameters: {
      type: "OBJECT",
      properties: {
        metric: S("spend|impressions|clicks|sessions|registration_starts|registrations|identified_people|verified_attendees"),
        campaign: S("optional"),
        granularity: S("day|week"),
        from: S("YYYY-MM-DD, optional"),
        as_of: AS_OF,
      },
      required: ["metric"],
    },
  },
  {
    name: "query_records",
    description:
      "Count/sum over cleaned rows of people|interactions|registrations|registration_history|checkins|campaign_daily for questions other tools miss. Extra fields: person_type; registrations.current_status/attended; people.registered/attended; derived date/week/month/weekday/hour. Add person_type=external for target metrics.",
    parameters: {
      type: "OBJECT",
      properties: {
        table: S("table name"),
        filters: {
          type: "ARRAY",
          items: { type: "OBJECT", properties: { field: S("field"), op: S("eq|neq|in|not_in|gt|gte|lt|lte|contains|is_null|not_null"), value: S("value; lists comma-separated") }, required: ["field", "op"] },
        },
        group_by: S("optional field"),
        aggregate: S("count | count_distinct:<f> | sum:<f> | avg:<f> | min:<f> | max:<f>"),
        limit: N("max groups"),
        sample_rows: N("0-10 example rows"),
        as_of: AS_OF,
      },
      required: ["table"],
    },
  },
  {
    name: "get_plan_2027",
    description: "The 2027 strategy in the app: five ranked bets with this week's early-signal readings, scale/stop lines, live Scale/Change/Stop label and next action; registration pace vs the 2025 curve; attendance and day-1 forecast vs venue cap; budget allocation. Readings are typed in by the team (or a simulated example).",
    parameters: { type: "OBJECT", properties: {} },
  },
  { name: "get_tasks", description: "Tasks with owner, campaign, due date, status; open and overdue counts.", parameters: { type: "OBJECT", properties: { status: S("todo|in_progress|blocked|done|open"), owner: S("optional"), campaign: S("optional") } } },
  {
    name: "simulate_budget",
    description: "Model estimate of attendees if campaign spend changes (baseline vs scenario).",
    parameters: {
      type: "OBJECT",
      properties: {
        moves: { type: "ARRAY", items: { type: "OBJECT", properties: { campaign: S("name or ID"), new_spend: N("new total INR") }, required: ["campaign", "new_spend"] } },
        elasticity: N("default 0.4"),
        show_uplift_pts: N("default 0"),
        walkin_share: N("default: the actual walk-in share"),
        as_of: AS_OF,
      },
      required: ["moves"],
    },
  },
  { name: "calculate", description: "Exact arithmetic: + - * / % ^ ( ) round(x,d) min max abs sqrt. No thousands separators.", parameters: { type: "OBJECT", properties: { expression: S("expression") }, required: ["expression"] } },
  {
    name: "propose_task",
    description: "Draft a task; saved only after the user clicks Confirm.",
    parameters: {
      type: "OBJECT",
      properties: { title: S("imperative title"), description: S("why (data) and done-when"), campaign: S("optional"), owner: S("optional; default campaign owner"), due_date: S("YYYY-MM-DD"), priority: S("high|medium|low") },
      required: ["title", "description"],
    },
  },
  {
    name: "propose_campaign_update",
    description: "Draft a campaign plan change (status/budget/notes); saved only after Confirm.",
    parameters: {
      type: "OBJECT",
      properties: { campaign: S("name or ID"), plan_status: S("active|scaling|paused|stopped"), planned_budget_inr: N("INR"), notes: S("reason") },
      required: ["campaign", "notes"],
    },
  },
];

// ---------------- implementations ----------------

const DICTIONARY_NOTES = {
  counting_rules: [
    "Duplicate source IDs are import copies and count once.",
    "Only person_type = external counts toward targets.",
    "Attendee = distinct external person with an admitted AND verified check-in (two days = one attendee).",
    "Registration status = latest history version at or before the snapshot.",
    "A snapshot date = end of that day in IST; later records are excluded.",
    "Impressions, clicks, reach, sessions and form starts are anonymous event counts, not unique people; summed reach is not unique reach.",
    "Spend is net (vendor credits are negative rows).",
    "Campaign attribution = the campaign recorded on the registration (single-touch); walk-ins have none.",
  ],
  not_in_data: [
    "College, city, age, gender, course or year of study of any person",
    "Ticket price or revenue (registration appears to be free)",
    "Sponsor or partner details, event programme, artists or sessions",
    "Venue capacity (only waitlisted status hints at limits)",
    "Feedback, satisfaction or NPS",
    "Multi-touch attribution or cross-campaign overlap",
    "Planned per-campaign budgets (unless the team sets one in this app)",
    "Any observed data about other years; the 2027 plan (get_plan_2027) holds team-entered readings or a simulated example, not dataset facts",
  ],
};

async function tool_dictionary(ctx: ToolCtx) {
  const st = await ctx.load();
  const { ds } = clean(st.ds);
  return {
    event: st.snapshot.event,
    tables: {
      campaigns: { rows: ds.campaigns.length, fields: Object.keys(ds.campaigns[0] ?? {}) },
      campaign_daily: { rows: ds.campaign_daily.length, fields: Object.keys(ds.campaign_daily[0] ?? {}) },
      people: { rows: ds.people.length, fields: Object.keys(ds.people[0] ?? {}) },
      interactions: { rows: ds.interactions.length, fields: Object.keys(ds.interactions[0] ?? {}), event_types: [...new Set(ds.interactions.map((i) => i.event_type))] },
      registrations: { rows: ds.registrations.length, fields: Object.keys(ds.registrations[0] ?? {}) },
      registration_history: { rows: ds.registration_history.length, statuses: [...new Set(ds.registration_history.map((h) => h.status))] },
      checkins: { rows: ds.checkins.length, results: [...new Set(ds.checkins.map((c) => c.result))], sources: [...new Set(ds.checkins.map((c) => c.source))] },
      targets: ds.targets,
    },
    campaigns: st.snapshot.campaigns.map((c) => ({ id: c.campaign_id, name: c.campaign_name, channel: c.channel, owner: c.owner_name })),
    owners: st.owners,
    app_records: ["tasks", "campaign plans (status, planned budget, notes)", "decision rules", "2027 plan: bets, weekly readings, thresholds, budget, venue cap", "audit log"],
    ...DICTIONARY_NOTES,
  };
}

async function tool_overview(a: Args, ctx: ToolCtx) {
  const st = await ctx.load(asOfArg(a, ctx));
  const s = st.snapshot;
  const counts: Record<string, number> = {};
  for (const c of s.campaigns) counts[c.decision.status] = (counts[c.decision.status] ?? 0) + 1;
  return {
    as_of: s.as_of,
    event: s.event,
    targets_in_force: s.targets,
    totals: s.totals,
    progress_vs_targets: s.progress,
    projection: s.projection,
    decision_counts: counts,
    data_quality: s.data_quality,
    decision_rules: st.settings.rules,
  };
}

async function tool_campaigns(a: Args, ctx: ToolCtx) {
  const st = await ctx.load(asOfArg(a, ctx));
  const s = st.snapshot;
  const pick = (c: (typeof s.campaigns)[number]) => ({
    id: c.campaign_id,
    name: c.campaign_name,
    channel: c.channel,
    owner: c.owner_name,
    plan_status: c.plan_status,
    planned_budget_inr: c.planned_budget_inr,
    spend_inr: c.spend_inr,
    share_of_spend: c.share_of_spend,
    impressions: c.impressions,
    clicks: c.clicks,
    landing_page_sessions: c.landing_page_sessions,
    registration_starts: c.registration_starts,
    identified_people: c.identified_people,
    registrations: c.registrations,
    status_counts: c.status_counts,
    verified_attendees: s.event.phase === "post_event" ? c.attendees : `${c.attendees} so far (event not over)`,
    share_of_attendees: c.share_of_attendees,
    rates: c.rates,
    cost_per_identified: c.cost_per_identified,
    cost_per_registration: c.cost_per_registration,
    cost_per_attendee: c.cost_per_attendee,
    budget_used_pct: c.budget_used_pct,
    weakest_stage_vs_average: c.bottleneck,
    decision: c.decision,
  });
  if (a.campaign) {
    const c = findCampaign(st, a.campaign);
    if (!c) return { error: `No campaign matches "${a.campaign}".`, available: s.campaigns.map((x) => x.campaign_name) };
    return {
      as_of: s.as_of,
      campaign: { ...pick(c), target_audience: c.target_audience, objective: c.objective, planned_start_at: c.planned_start_at, planned_end_at: c.planned_end_at, notes: st.plans[c.campaign_id]?.notes ?? "" },
      portfolio_rates: s.portfolio_rates,
      tasks: st.tasks.filter((t) => t.campaign_id === c.campaign_id),
    };
  }
  // List mode: drop raw anonymous traffic counts (rates already summarise them; ask for one campaign for the counts).
  const brief = (c: (typeof s.campaigns)[number]) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { impressions, clicks, landing_page_sessions, registration_starts, share_of_spend, ...rest } = pick(c);
    return rest;
  };
  return { as_of: s.as_of, phase: s.event.phase, campaigns: s.campaigns.map(brief), portfolio_rates: s.portfolio_rates, unattributed_walk_in_attendees: s.data_quality.unattributed_attendees, note: "Call again with campaign=<name> for raw impressions/clicks/sessions." };
}

async function tool_diagnostics(a: Args, ctx: ToolCtx) {
  const st = await ctx.load(asOfArg(a, ctx));
  const s = st.snapshot;
  return {
    as_of: s.as_of,
    phase: s.event.phase,
    portfolio_rates: s.portfolio_rates,
    weakest_stage_by_campaign: s.campaigns.map((c) => ({ campaign: c.campaign_name, bottleneck: c.bottleneck, rates: c.rates })),
    spend_vs_attendee_share: s.campaigns.map((c) => ({ campaign: c.campaign_name, share_of_spend: c.share_of_spend, share_of_attendees: c.share_of_attendees, cost_per_attendee: c.cost_per_attendee })),
    engagement_drivers: s.engagement_drivers ?? "Only available after the event, when attendance is known.",
    lost_registrations: s.totals.lost_registrations ?? "Only available after the event.",
    caveat: "Engagement drivers are correlations between actions and attendance, not proof of cause.",
  };
}

function weekStart(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

async function tool_timeseries(a: Args, ctx: ToolCtx) {
  const asOf = asOfArg(a, ctx);
  const st = await ctx.load(asOf);
  const { ds } = clean(st.ds);
  const T = endOfDayMs(asOf);
  const metric = String(a.metric ?? "");
  const gran = a.granularity === "day" ? "day" : "week";
  const from = typeof a.from === "string" ? a.from : "0000-00-00";
  let camp: { campaign_id: string; campaign_name: string } | null = null;
  if (a.campaign) {
    const c = findCampaign(st, a.campaign);
    if (!c) return { error: `No campaign matches "${a.campaign}".` };
    camp = c;
  }
  const ext = new Set(ds.people.filter((p) => p.person_type === "external").map((p) => p.person_id));
  const points = new Map<string, number>();
  const add = (date: string, v: number) => {
    if (date < from || date > asOf) return;
    const k = gran === "day" ? date : weekStart(date);
    points.set(k, (points.get(k) ?? 0) + v);
  };
  const dailyField: Record<string, keyof (typeof ds.campaign_daily)[number]> = {
    spend: "marketing_spend_inr", impressions: "impressions", clicks: "clicks", sessions: "landing_page_sessions", registration_starts: "registration_starts",
  };
  if (dailyField[metric]) {
    for (const d of ds.campaign_daily) if (!camp || d.campaign_id === camp.campaign_id) add(d.activity_date, Number(d[dailyField[metric]]));
  } else if (metric === "registrations") {
    for (const r of ds.registrations) if (ext.has(r.person_id) && Date.parse(r.registered_at) <= T && (!camp || r.campaign_id === camp.campaign_id)) add(istDate(r.registered_at), 1);
  } else if (metric === "identified_people") {
    for (const p of ds.people) if (p.person_type === "external" && Date.parse(p.first_seen_at) <= T && (!camp || p.first_campaign_id === camp.campaign_id)) add(istDate(p.first_seen_at), 1);
  } else if (metric === "verified_attendees") {
    const seen = new Set<string>();
    const regCamp = new Map(ds.registrations.map((r) => [r.person_id, r.campaign_id]));
    const rows = ds.checkins.filter((c) => isVerifiedAdmission(c) && ext.has(c.person_id) && Date.parse(c.occurred_at) <= T).sort((x, y) => Date.parse(x.occurred_at) - Date.parse(y.occurred_at));
    for (const c of rows) {
      if (camp && regCamp.get(c.person_id) !== camp.campaign_id) continue;
      const key = gran === "day" ? `${istDate(c.occurred_at)}|${c.person_id}` : c.person_id;
      if (seen.has(key)) continue;
      seen.add(key);
      add(istDate(c.occurred_at), 1);
    }
  } else {
    return { error: `Unknown metric "${metric}".` };
  }
  const series = [...points].sort(([x], [y]) => x.localeCompare(y)).map(([period, value]) => ({ period, value }));
  return {
    metric, granularity: gran, campaign: camp?.campaign_name ?? "all", as_of: asOf, series,
    total: series.reduce((s, p) => s + p.value, 0),
    note: metric === "verified_attendees"
      ? gran === "day" ? "Distinct people per day; a person attending both days appears on both days." : "Each person counted once, in the week of their first verified admission."
      : ["impressions", "clicks", "sessions", "registration_starts"].includes(metric) ? "Anonymous event counts, not unique people." : undefined,
  };
}

type Row = Record<string, unknown>;
const TS_FIELD: Record<string, string> = { people: "first_seen_at", interactions: "occurred_at", registrations: "registered_at", registration_history: "effective_at", checkins: "occurred_at", campaign_daily: "activity_date" };

async function tool_query(a: Args, ctx: ToolCtx) {
  const asOf = asOfArg(a, ctx);
  const st = await ctx.load(asOf);
  const { ds } = clean(st.ds);
  const T = endOfDayMs(asOf);
  const table = String(a.table ?? "");
  if (!(table in TS_FIELD)) return { error: `Unknown table "${table}". Use one of ${Object.keys(TS_FIELD).join(", ")}.` };
  const tsField = TS_FIELD[table];
  const ptype = new Map(ds.people.map((p) => [p.person_id, p.person_type]));
  const statuses = latestStatuses(ds.registration_history, T);
  const attendees = new Set(ds.checkins.filter((c) => isVerifiedAdmission(c) && Date.parse(c.occurred_at) <= T && ptype.get(c.person_id) === "external").map((c) => c.person_id));
  const registered = new Set(ds.registrations.filter((r) => Date.parse(r.registered_at) <= T).map((r) => r.person_id));

  let rows: Row[] = (ds[table as keyof typeof ds] as unknown as Row[]).filter((r) => {
    const v = String(r[tsField] ?? "");
    return tsField === "activity_date" ? v <= asOf : Date.parse(v) <= T;
  });
  rows = rows.map((r) => {
    const out: Row = { ...r };
    if (typeof r.person_id === "string") out.person_type = ptype.get(r.person_id) ?? null;
    if (table === "registrations") { out.current_status = statuses.get(String(r.registration_id)) ?? "interested"; out.attended = attendees.has(String(r.person_id)); }
    if (table === "people") { out.registered = registered.has(String(r.person_id)); out.attended = attendees.has(String(r.person_id)); }
    const ts = String(r[tsField]);
    const date = tsField === "activity_date" ? ts : istDate(ts);
    out.date = date;
    out.week = weekStart(date);
    out.month = date.slice(0, 7);
    out.weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    if (tsField !== "activity_date") out.hour = new Date(Date.parse(ts) + 5.5 * 3600e3).getUTCHours();
    return out;
  });

  const filters = Array.isArray(a.filters) ? (a.filters as Row[]) : [];
  const known = new Set(rows.length ? Object.keys(rows[0]) : []);
  for (const f of filters) {
    const field = String(f.field);
    if (rows.length && !known.has(field)) return { error: `Field "${field}" is not in ${table}.`, available_fields: [...known] };
    const op = String(f.op ?? "eq");
    const raw = f.value;
    const val = raw === "true" ? true : raw === "false" ? false : raw;
    const list = String(raw ?? "").split(",").map((x) => x.trim());
    const numv = Number(raw);
    rows = rows.filter((r) => {
      const x = r[field];
      switch (op) {
        case "eq": return String(x).toLowerCase() === String(val).toLowerCase();
        case "neq": return String(x).toLowerCase() !== String(val).toLowerCase();
        case "in": return list.map((l) => l.toLowerCase()).includes(String(x).toLowerCase());
        case "not_in": return !list.map((l) => l.toLowerCase()).includes(String(x).toLowerCase());
        case "gt": return typeof x === "number" ? x > numv : String(x) > String(raw);
        case "gte": return typeof x === "number" ? x >= numv : String(x) >= String(raw);
        case "lt": return typeof x === "number" ? x < numv : String(x) < String(raw);
        case "lte": return typeof x === "number" ? x <= numv : String(x) <= String(raw);
        case "contains": return String(x ?? "").toLowerCase().includes(String(raw ?? "").toLowerCase());
        case "is_null": return x == null || x === "";
        case "not_null": return !(x == null || x === "");
        default: return true;
      }
    });
  }

  const agg = String(a.aggregate ?? "count");
  const [aggFn, aggField] = agg.split(":");
  if (aggFn !== "count" && rows.length && !known.has(aggField)) return { error: `Field "${aggField}" is not in ${table}.`, available_fields: [...known] };
  const reduce = (rs: Row[]): number | null => {
    if (aggFn === "count") return rs.length;
    if (aggFn === "count_distinct") return new Set(rs.map((r) => r[aggField])).size;
    const nums = rs.map((r) => Number(r[aggField])).filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    if (aggFn === "sum") return nums.reduce((s, n) => s + n, 0);
    if (aggFn === "avg") return r2(nums.reduce((s, n) => s + n, 0) / nums.length);
    if (aggFn === "min") return Math.min(...nums);
    if (aggFn === "max") return Math.max(...nums);
    return null;
  };
  const limit = Math.min(200, Math.max(1, Number(a.limit ?? 50) || 50));
  const out: Row = {
    table, as_of: asOf, filters, aggregate: agg, rows_matched: rows.length, value: reduce(rows),
    applied_rules: ["Deduplicated by source ID", `Only rows with ${tsField} on or before the end of ${asOf} (IST)`, "No person_type filter unless you added one: add {field:'person_type', op:'eq', value:'external'} to follow the target definition"],
  };
  if (a.group_by) {
    const g = String(a.group_by);
    if (rows.length && !known.has(g)) return { error: `Cannot group by "${g}".`, available_fields: [...known] };
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = String(r[g] ?? "(blank)"); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const arr = [...groups].map(([k, rs]) => ({ group: k, value: reduce(rs), rows: rs.length }));
    const timeLike = ["date", "week", "month", "hour"].includes(g);
    arr.sort((x, y) => (timeLike ? x.group.localeCompare(y.group) : (Number(y.value) || 0) - (Number(x.value) || 0)));
    out.groups = arr.slice(0, limit);
    out.group_count = arr.length;
  }
  const n = Math.min(10, Math.max(0, Number(a.sample_rows ?? 0) || 0));
  if (n) out.sample = rows.slice(0, n);
  return out;
}

async function tool_tasks(a: Args, ctx: ToolCtx) {
  const st = await ctx.load();
  const today = new Date().toISOString().slice(0, 10);
  let tasks = st.tasks;
  if (a.status === "open") tasks = tasks.filter((t) => t.status !== "done");
  else if (typeof a.status === "string" && a.status) tasks = tasks.filter((t) => t.status === a.status);
  if (a.owner) { const o = findOwner(st, a.owner); tasks = tasks.filter((t) => o && t.owner_id === o.owner_id); }
  if (a.campaign) { const c = findCampaign(st, a.campaign); tasks = tasks.filter((t) => c && t.campaign_id === c.campaign_id); }
  const name = (id: string | null) => st.owners.find((o) => o.owner_id === id)?.owner_name ?? "Unassigned";
  const camp = (id: string | null) => st.snapshot.campaigns.find((c) => c.campaign_id === id)?.campaign_name ?? null;
  return {
    today,
    total_tasks: st.tasks.length,
    open: st.tasks.filter((t) => t.status !== "done").length,
    overdue: st.tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length,
    tasks: tasks.slice(0, 60).map((t) => ({ ...t, owner: name(t.owner_id), campaign: camp(t.campaign_id), overdue: !!(t.status !== "done" && t.due_date && t.due_date < today) })),
  };
}

async function tool_simulate(a: Args, ctx: ToolCtx) {
  const st = await ctx.load(asOfArg(a, ctx));
  const moves = Array.isArray(a.moves) ? (a.moves as Row[]) : [];
  const allocation: Record<string, number> = {};
  for (const m of moves) {
    const c = findCampaign(st, m.campaign);
    if (!c) return { error: `No campaign matches "${m.campaign}".` };
    const v = Number(m.new_spend);
    if (!Number.isFinite(v) || v < 0) return { error: `new_spend for ${c.campaign_name} must be a non-negative number.` };
    allocation[c.campaign_id] = v;
  }
  const params = {
    elasticity: Number.isFinite(Number(a.elasticity)) && a.elasticity != null ? Number(a.elasticity) : 0.4,
    show_uplift_pts: Number(a.show_uplift_pts ?? 0) || 0,
    walkin_share:
      a.walkin_share != null && Number.isFinite(Number(a.walkin_share))
        ? Number(a.walkin_share)
        : st.snapshot.event.phase === "post_event" && st.snapshot.totals.unique_attendees > 0
          ? st.snapshot.totals.walk_in_attendees / st.snapshot.totals.unique_attendees
          : st.settings.assumed_walkin_share,
    max_show_rate: 0.92,
  };
  const base = simulatePlan(st.snapshot, { ...params, allocation: {} });
  const scen = simulatePlan(st.snapshot, { ...params, allocation });
  return {
    as_of: st.snapshot.as_of,
    label: "MODEL ESTIMATE, not observed data",
    baseline: { total_spend: base.total_spend, registrations: base.registrations, unique_attendees: base.unique_attendees, cost_per_attendee: base.cost_per_attendee },
    scenario: { total_spend: scen.total_spend, registrations: scen.registrations, unique_attendees: scen.unique_attendees, cost_per_attendee: scen.cost_per_attendee },
    delta_unique_attendees: scen.unique_attendees - base.unique_attendees,
    delta_spend: scen.total_spend - base.total_spend,
    changed_campaigns: scen.rows.filter((r) => r.campaign_id in allocation),
    assumptions: scen.assumptions,
    warnings: scen.warnings,
  };
}

async function tool_plan2027(ctx: ToolCtx) {
  const st = await ctx.load();
  const p = st.plan2027;
  return {
    note: p.simulated
      ? "These readings are the SIMULATED week-3 example shipped with the app, not real 2027 data. Say so when you use them."
      : `Readings entered by the team${p.updated_at ? ` (last saved ${p.updated_at.slice(0, 10)})` : ""}. 2027 has not happened in the dataset; this is plan tracking.`,
    week: p.week,
    bets: p.bets.map((b) => ({
      bet: `Bet ${b.rank} ${b.name}`, score: b.score, signal: b.signal, reading: b.reading, unit: b.unit, scale_at_or_above: b.scale_at, stop_below: b.stop_below,
      label: b.label, reason: b.reason, next_action: b.action, budget_inr: b.budget_inr, owner_role: b.owner_role, weeks: b.weeks,
      extra_attendees_vs_2025: b.extra_attendees, biggest_risk: b.risk, related_2025_campaign: b.campaign_name,
      task_owner: (b.campaign_name && st.snapshot.campaigns.find((c) => c.campaign_name === b.campaign_name)?.owner_name) || null,
    })),
    for_tasks: "Recommend each bet's next_action as written. For a task about a bet, pass campaign = related_2025_campaign (if any) and owner = task_owner; leave owner empty when it is null.",
    label_counts: p.counts,
    budget: { total_inr: p.budget.total_inr, allocated_inr: p.budget.allocated_inr, gap_inr: p.budget.gap_inr, advice: p.budget.advice },
    pace: p.pace,
    forecast: p.forecast,
    venue_ceiling_unique_people: p.ceiling,
    assumptions: p.assumptions,
  };
}

async function tool_propose_task(a: Args, ctx: ToolCtx) {
  const st = await ctx.load();
  const title = String(a.title ?? "").trim();
  if (!title) return { error: "title is required" };
  let campaign_id: string | null = null;
  let owner_id: string | null = null;
  if (a.campaign) {
    const c = findCampaign(st, a.campaign);
    if (!c) return { error: `No campaign matches "${a.campaign}".` };
    campaign_id = c.campaign_id;
    owner_id = c.owner_id;
  }
  if (a.owner) {
    const o = findOwner(st, a.owner);
    if (!o) return { error: `No owner matches "${a.owner}". Owners: ${st.owners.map((x) => x.owner_name).join(", ")}` };
    owner_id = o.owner_id;
  }
  const due = typeof a.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null;
  const priority = ["high", "medium", "low"].includes(String(a.priority)) ? String(a.priority) : "medium";
  const p: Proposal = {
    id: `P${ctx.proposals.length + 1}-${Date.now().toString(36)}`,
    kind: "create_task",
    summary: `Create task "${title}"`,
    payload: { title, description: String(a.description ?? ""), campaign_id, owner_id, due_date: due, priority },
  };
  ctx.proposals.push(p);
  return { status: "PROPOSED, NOT SAVED. The user must click Confirm in the chat to create it.", proposal: p };
}

async function tool_propose_campaign(a: Args, ctx: ToolCtx) {
  const st = await ctx.load();
  const c = findCampaign(st, a.campaign);
  if (!c) return { error: `No campaign matches "${a.campaign}".` };
  const payload: Record<string, unknown> = {};
  if (a.plan_status) {
    if (!["active", "scaling", "paused", "stopped"].includes(String(a.plan_status))) return { error: "plan_status must be active, scaling, paused or stopped" };
    payload.plan_status = a.plan_status;
  }
  if (a.planned_budget_inr != null) {
    const v = Number(a.planned_budget_inr);
    if (!Number.isFinite(v) || v < 0) return { error: "planned_budget_inr must be a non-negative number" };
    payload.planned_budget_inr = Math.round(v);
  }
  payload.notes = String(a.notes ?? "");
  const parts = [payload.plan_status && `status → ${payload.plan_status}`, payload.planned_budget_inr != null && `planned budget → ₹${Number(payload.planned_budget_inr).toLocaleString("en-IN")}`].filter(Boolean);
  const p: Proposal = { id: `P${ctx.proposals.length + 1}-${Date.now().toString(36)}`, kind: "update_campaign", target_id: c.campaign_id, summary: `Update ${c.campaign_name}: ${parts.join(", ") || "notes"}`, payload };
  ctx.proposals.push(p);
  return { status: "PROPOSED, NOT SAVED. The user must click Confirm in the chat to apply it.", proposal: p };
}

// Round numbers so tool results are short (free model tiers limit tokens per minute) and money reads cleanly.
function compact(v: unknown, key = ""): unknown {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v;
    if (/^cost_|_inr$/.test(key)) return Math.round(v); // money: whole rupees (shares/rates keep decimals)
    return Math.round(v * 1000) / 1000;
  }
  if (Array.isArray(v)) return v.map((x) => compact(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, k)]));
  return v;
}

export async function runTool(name: string, args: Args, ctx: ToolCtx): Promise<unknown> {
  return compact(await runToolRaw(name, args, ctx));
}

async function runToolRaw(name: string, args: Args, ctx: ToolCtx): Promise<unknown> {
  try {
    switch (name) {
      case "get_data_dictionary": return await tool_dictionary(ctx);
      case "get_overview": return await tool_overview(args, ctx);
      case "get_campaigns": return await tool_campaigns(args, ctx);
      case "get_diagnostics": return await tool_diagnostics(args, ctx);
      case "get_timeseries": return await tool_timeseries(args, ctx);
      case "query_records": return await tool_query(args, ctx);
      case "get_tasks": return await tool_tasks(args, ctx);
      case "get_plan_2027": return await tool_plan2027(ctx);
      case "simulate_budget": return await tool_simulate(args, ctx);
      case "calculate": {
        const expr = String(args.expression ?? "");
        return { expression: expr, result: r2(calculate(expr), 6) };
      }
      case "propose_task": return await tool_propose_task(args, ctx);
      case "propose_campaign_update": return await tool_propose_campaign(args, ctx);
      default: return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
