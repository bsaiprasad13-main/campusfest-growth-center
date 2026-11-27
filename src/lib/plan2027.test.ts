import { describe, expect, it } from "vitest";
import { applyPlanPatch, curveShare, defaultPlan2027, evaluatePlan, labelFor } from "./plan2027";

describe("2027 plan", () => {
  it("labels readings with the Slide 3 lines", () => {
    expect(labelFor(15, 15, 8)).toBe("scale");
    expect(labelFor(12, 15, 8)).toBe("change");
    expect(labelFor(7.9, 15, 8)).toBe("stop");
    expect(labelFor(null, 15, 8)).toBe("no_reading");
  });

  it("follows the 2025 registration curve (30/46/65/90% by weeks 3/5/7/9)", () => {
    expect(curveShare(3)).toBeCloseTo(0.3);
    expect(curveShare(9)).toBeCloseTo(0.9);
    expect(curveShare(4)).toBeCloseTo(0.38);
    expect([3, 5, 7, 9].map((w) => Math.round(3700 * curveShare(w)))).toEqual([1110, 1702, 2405, 3330]);
  });

  it("evaluates the shipped simulated week-3 example", () => {
    const e = evaluatePlan(defaultPlan2027());
    expect(e.simulated).toBe(true);
    expect(e.bets.map((b) => b.label)).toEqual(["change", "no_reading", "scale", "stop", "no_reading"]);
    expect(e.bets[3].action).toMatch(/bottom half/);
    expect(e.budget).toMatchObject({ allocated_inr: 500000, total_inr: 500000, status: "balanced" });
    expect(e.pace).toMatchObject({ expected: 1110, status: "on_track" });
    expect(e.forecast!.unique_attendees).toBe(Math.round(((980 / 0.3) * 0.77) / 0.94));
    expect(e.ceiling).toBe(5910); // 4,000 × 2 ÷ (1 + 725 ÷ 2,050)
    expect(e.target_capacity.map((t) => t.day1_peak)).toEqual([2105, 3348]);
  });

  it("responds to changed constraints: budget, cap and pace", () => {
    const p = applyPlanPatch(defaultPlan2027(), { budget_inr: 450000, cap_per_day: 1700, week: 5, registrations_to_date: 1300 });
    const e = evaluatePlan(p);
    expect(e.simulated).toBe(false);
    expect(e.budget.status).toBe("over");
    expect(e.budget.advice).toMatch(/Bet 5/);
    expect(e.pace!.status).toBe("behind"); // 1,300 vs 1,702 expected = 76%
    expect(e.forecast!.day1_peak).toBe(Math.round(((1300 / 0.46) * 0.77 / 0.94) * (1430 / 2050)));
    expect(e.target_capacity.find((t) => t.target === "stretch")).toMatchObject({ day1_peak: 3348, headroom: 1700 - 3348, status: "over_cap" });
    expect(e.forecast!.day1_status).toBe("near_cap"); // above 90% of 1,700
  });

  it("rejects bad input with readable messages", () => {
    expect(() => applyPlanPatch(defaultPlan2027(), { week: 12 })).toThrow(/week/i);
    expect(() => applyPlanPatch(defaultPlan2027(), { bets: { B1: { stop_below: 20 } } })).toThrow(/stop line/);
    expect(() => applyPlanPatch(defaultPlan2027(), { bets: { B9: { reading: 1 } } })).toThrow(/Unknown bet/);
    expect(applyPlanPatch(defaultPlan2027(), { bets: { B2: { reading: 9 } } }).bets.B2.reading).toBe(9);
  });
});
