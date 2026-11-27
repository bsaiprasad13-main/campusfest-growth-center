// Expected values were computed independently in Python (pandas) from the original xlsx.
import { describe, expect, it } from "vitest";
import { computeSnapshot } from "./engine";
import { simulatePlan } from "./planner";
import { initialAppState, loadSeedDataset } from "./seed";

const ds = loadSeedDataset();
const app = initialAppState(ds);

describe("final snapshot (2025-04-20)", () => {
  const s = computeSnapshot(ds, app, "2025-04-20");

  it("applies the dedupe rules", () => {
    expect(s.data_quality.duplicates_removed.campaign_daily).toBe(2);
    expect(s.data_quality.duplicates_removed.registration_history).toBe(4);
    expect(s.data_quality.duplicates_removed.checkins).toBe(20);
  });

  it("counts the funnel like the source rules say", () => {
    expect(s.event.phase).toBe("post_event");
    expect(s.totals.identified_people).toBe(3625);
    expect(s.totals.registrations).toBe(2800);
    expect(s.totals.unique_attendees).toBe(2050);
    expect(s.totals.registered_attendees).toBe(1925);
    expect(s.totals.walk_in_attendees).toBe(125);
    expect(s.totals.attendees_both_days).toBe(725);
    expect(s.totals.spend_inr).toBe(274000);
    expect(s.totals.status_counts.confirmed).toBe(2500);
    expect(s.totals.lost_registrations?.confirmed_no_show).toBe(575);
    expect(s.data_quality.excluded_non_external_admissions).toBe(40);
  });

  it("uses the revised targets", () => {
    expect(s.targets?.target_version).toBe("Attendee revised plan");
    expect(s.targets?.unique_external_visitors_goal).toBe(2200);
  });

  it("computes per-campaign economics", () => {
    const paid = s.campaigns.find((c) => c.campaign_name === "Paid Social")!;
    expect(paid.spend_inr).toBe(93000);
    expect(paid.registrations).toBe(680);
    expect(paid.attendees).toBe(340);
    expect(paid.rates.registered_to_attended).toBeCloseTo(0.5, 4);
    expect(paid.decision.status).toBe("stop");
    const ref = s.campaigns.find((c) => c.campaign_name === "Student Referrals")!;
    expect(ref.attendees).toBe(275);
    expect(ref.decision.status).toBe("scale");
    const amb = s.campaigns.find((c) => c.campaign_name === "Campus Ambassadors")!;
    expect(amb.decision.status).toBe("change");
    expect(s.campaigns.reduce((a, c) => a + c.attendees, 0) + s.data_quality.unattributed_attendees).toBe(2050);
  });

  it("finds engagement drivers", () => {
    const b = s.engagement_drivers!.find((d) => d.event_type === "brochure_download")!;
    expect(b.show_rate_with).toBeCloseTo(0.747, 2);
  });
});

describe("snapshots never leak future data", () => {
  it("day 1 of the event", () => {
    const s = computeSnapshot(ds, app, "2025-04-12");
    expect(s.event.phase).toBe("during_event");
    expect(s.totals.unique_attendees).toBe(1430); // distinct external people, not the 1,905 raw day-1 records
  });
  it("before the target revision", () => {
    const s = computeSnapshot(ds, app, "2025-03-14");
    expect(s.event.phase).toBe("pre_event");
    expect(s.targets?.target_version).toBe("Attendee launch plan");
    expect(s.totals.unique_attendees).toBe(0);
    expect(s.totals.registrations).toBeLessThan(2800);
    expect(s.projection.method).toBe("run-rate");
  });
});

describe("planner", () => {
  it("reproduces current results at current spend with no assumptions", () => {
    const s = computeSnapshot(ds, app, "2025-04-20");
    const r = simulatePlan(s, { allocation: {}, elasticity: 0.4, show_uplift_pts: 0, walkin_share: 0.06, max_show_rate: 0.92 });
    expect(r.registered_attendees).toBe(1925);
    expect(r.total_spend).toBe(274000);
  });
});
