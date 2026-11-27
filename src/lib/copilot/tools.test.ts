import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../engine";
import { initialAppState, loadSeedDataset } from "../seed";
import { defaultPlan2027, evaluatePlan } from "../plan2027";
import type { LoadedState } from "../state";
import { calculate } from "./calc";
import { runTool, type ToolCtx } from "./tools";

const ds = loadSeedDataset();
const app = initialAppState(ds);
const owners = [...new Map(ds.campaigns.map((c) => [c.owner_id, c.owner_name]))].map(([owner_id, owner_name]) => ({ owner_id, owner_name }));
const ctx = (asOf = "2025-04-20"): ToolCtx => ({
  defaultAsOf: asOf,
  proposals: [],
  load: async (d?: string) =>
    ({ snapshot: computeSnapshot(ds, app, d ?? asOf), tasks: app.tasks, plans: app.plans, settings: app.settings, plan2027: evaluatePlan(app.plan2027 ?? defaultPlan2027()), plan2027_inputs: app.plan2027 ?? defaultPlan2027(), audit: [], owners, targets_history: ds.targets, storage: "test", ds, app }) as LoadedState,
});

describe("calculate", () => {
  it("does exact arithmetic", () => {
    expect(calculate("93000 / 340")).toBeCloseTo(273.53, 2);
    expect(calculate("round((2050 - 2200) / 2200 * 100, 1)")).toBe(-6.8);
    expect(calculate("2^3 + max(1, 4) - -1")).toBe(13);
    expect(() => calculate("1/0")).toThrow();
    expect(() => calculate("process.exit()")).toThrow();
  });
});

describe("query_records", () => {
  it("counts manual verified admissions of external people by date", async () => {
    const r = (await runTool("query_records", {
      table: "checkins",
      filters: [
        { field: "result", op: "eq", value: "admitted" },
        { field: "verification", op: "eq", value: "verified" },
        { field: "person_type", op: "eq", value: "external" },
      ],
      aggregate: "count_distinct:person_id",
    }, ctx())) as { value: number };
    expect(r.value).toBe(2050);
  });

  it("reports unknown fields instead of guessing", async () => {
    const r = (await runTool("query_records", { table: "people", group_by: "college" }, ctx())) as { error?: string };
    expect(r.error).toMatch(/college/);
  });

  it("respects the snapshot date", async () => {
    const r = (await runTool("query_records", { table: "registrations", filters: [{ field: "person_type", op: "eq", value: "external" }] }, ctx("2025-03-01"))) as { value: number };
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(2800);
  });
});

describe("other tools", () => {
  it("timeseries totals match the snapshot", async () => {
    const r = (await runTool("get_timeseries", { metric: "registrations", granularity: "week" }, ctx())) as { total: number };
    expect(r.total).toBe(2800);
    const a = (await runTool("get_timeseries", { metric: "verified_attendees", granularity: "week" }, ctx())) as { total: number };
    expect(a.total).toBe(2050);
  });

  it("simulates a budget move", async () => {
    const r = (await runTool("simulate_budget", { moves: [{ campaign: "Creator Partners", new_spend: 29000 }, { campaign: "Student Referrals", new_spend: 49000 }] }, ctx())) as { delta_spend: number; delta_unique_attendees: number };
    expect(r.delta_spend).toBe(0);
    expect(r.delta_unique_attendees).toBeGreaterThan(0);
  });

  it("only proposes tasks, never saves them", async () => {
    const c = ctx();
    const r = (await runTool("propose_task", { title: "Cut Paid Social prospecting", description: "₹274 per attendee", campaign: "paid social", priority: "high" }, c)) as { status: string };
    expect(r.status).toMatch(/NOT SAVED/);
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0].payload.owner_id).toBe("T04");
    expect(app.tasks).toHaveLength(0);
  });
});

describe("get_plan_2027", () => {
  it("returns the bets with live labels and flags simulated readings", async () => {
    const r = (await runTool("get_plan_2027", {}, ctx())) as { note: string; bets: { bet: string; label: string }[]; label_counts: Record<string, number> };
    expect(r.note).toMatch(/SIMULATED/);
    expect(r.bets).toHaveLength(5);
    expect(r.bets.find((b) => b.bet.startsWith("Bet 4"))!.label).toBe("stop");
    expect(r.label_counts.scale).toBe(1);
  });
});
