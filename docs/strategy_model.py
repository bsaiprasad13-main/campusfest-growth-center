"""Strategy model behind Slide 1 and Slide 2 of the deck (CampusFest 2027, Bengaluru, attendee growth).

Per-channel economics are taken from the cleaned 2025 dataset [DATA].
Plan inputs are [ASSUMPTION]s, explained in README section 3.3.
Run:  python -I -X utf8 docs/strategy_model.py
"""

# ---- 2025 cleaned per-channel economics [DATA] ----
# Fields: spend in INR, registrations (regs), attendees (att), identified people
CH = {
    "Student Referrals":    dict(impr=72438, spend=19000, regs=350, att=275, people=410),
    "College Partnerships": dict(impr=150205, spend=31000, regs=450, att=385, people=500),
    "Campus Ambassadors":   dict(impr=136929, spend=42000, regs=520, att=390, people=600),
    "Organic Search":       dict(impr=68402, spend=14000, regs=250, att=195, people=290),
    "Community Groups":     dict(impr=65682, spend=16000, regs=200, att=165, people=250),
    "Paid Social":          dict(impr=325693, spend=93000, regs=680, att=340, people=960),
    "Creator Partners":     dict(impr=209666, spend=59000, regs=350, att=175, people=490),
}
ATT_2025, SPEND_2025 = 2050, 274000
WAITLIST_SHARE = 88 / 2800        # share of registrations waitlisted and lost in 2025 [DATA]
BOTH_DAYS_SHARE = 725 / 2050      # 35% of attendees came on both days [DATA]
DAY1_SHARE = 1430 / 2050          # 70% of unique attendees were present on day 1 [DATA]

# ---- 2027 plan [ASSUMPTION] ----
BUDGET, CAP_PER_DAY = 500_000, 4000
ALLOC = {  # channel -> (strategy it belongs to, spend in INR)
    "College Partnerships": ("Bet 3 College Squad Passes", 110000),
    "Student Referrals":    ("Bet 1 Bring-Your-Crew referrals", 80000),
    "Campus Ambassadors":   ("Bet 4 Pay-per-attendee ambassadors", 90000),
    "Organic Search":       ("Always-on", 25000),
    "Community Groups":     ("Always-on", 35000),
    "Paid Social":          ("Capped: retargeting only", 40000),
    "Creator Partners":     ("Capped: performance only", 20000),
}
BET2_SHOWUP, BET5_WALKIN = 60000, 40000
assert sum(s for _, s in ALLOC.values()) + BET2_SHOWUP + BET5_WALKIN == BUDGET

SCEN = {
    # elasticity: cost per registration = 2025 cost x (spend ratio) ** e. A higher e means faster diminishing returns.
    # show_uplift: Bet 2 (show-up engine) lifts the share of registrations that attend by this many percentage points.
    # waitlist_recovery: Bet 2 converts waitlisted registrations at the channel's show rate.
    # crew_rate, crew_size, crew_show: Bet 1 crew pass. This share of non-referral registrants
    #   brings crew_size friends, who attend at crew_show.
    # walkin_share: walk-ins as a share of all attendees (Bet 5).
    "base":    dict(elasticity=0.40, show_uplift=0.00, waitlist_recovery=False,
                    crew_rate=0.00, crew_size=1.5, crew_show=0.80, walkin_share=0.06),
    "stretch": dict(elasticity=0.25, show_uplift=0.08, waitlist_recovery=True,
                    crew_rate=0.15, crew_size=1.5, crew_show=0.80, walkin_share=0.10),
}


def run(name, p):
    by_strat, tot_regs, tot_people, reg_att, tot_impr = {}, 0, 0, 0, 0
    print(f"\n=== {name.upper()} ===")
    print(f"{'channel':22}{'spend':>8}{'₹/reg':>7}{'people':>8}{'regs':>7}{'show':>6}{'att':>6}{'₹/att':>7}")
    s4_lift = 0.0
    crew = 0.0
    for ch, (strat, s) in ALLOC.items():
        b = CH[ch]
        cpr = b["spend"] / b["regs"] * max(1.0, s / b["spend"]) ** p["elasticity"]
        regs = s / cpr
        show0 = b["att"] / b["regs"]
        show = min(0.92, show0 + p["show_uplift"])
        att_core = regs * show0                    # attendees at the 2025 show rate
        s4_lift += regs * (show - show0)           # extra attendees from the show-up engine
        if p["waitlist_recovery"]:
            s4_lift += regs * WAITLIST_SHARE * show
        if ch != "Student Referrals":              # avoid double counting the referral channel
            crew += regs * p["crew_rate"] * p["crew_size"] * p["crew_show"]
        people = regs * b["people"] / b["regs"]
        by_strat[strat] = by_strat.get(strat, 0) + att_core
        tot_regs += regs
        tot_people += people
        tot_impr += people * b["impr"] / b["people"]
        reg_att += regs * show
        print(f"{ch:22}{s:>8}{cpr:>7.0f}{people:>8.0f}{regs:>7.0f}{show:>6.0%}{regs*show:>6.0f}{s/(regs*show):>7.0f}")
    by_strat["Bet 1 Bring-Your-Crew referrals"] += crew
    by_strat["Bet 2 Show-up engine"] = s4_lift
    registered_att = sum(v for k, v in by_strat.items())
    walk = registered_att * p["walkin_share"] / (1 - p["walkin_share"])
    by_strat["Bet 5 Walk-in capture + day-2 hook"] = walk
    unique = registered_att + walk

    print("\nAttendees by strategy:")
    for k in sorted(by_strat):
        print(f"  {k:40}{by_strat[k]:>7.0f}")
    print(f"UNIQUE ATTENDEES {unique:,.0f}  ({unique/ATT_2025:.2f}x 2025)  |  ₹/attendee {BUDGET/unique:.0f} "
          f"(2025: {SPEND_2025/ATT_2025:.0f})")
    print(f"Funnel: impressions {tot_impr:,.0f} -> identified people {tot_people:,.0f} -> registrations {tot_regs:,.0f} -> "
          f"registered attendees {registered_att:,.0f} (+{crew:.0f} crew, +{walk:.0f} walk-ins)")
    peak_unbal = unique * DAY1_SHARE
    peak_bal = unique * (1 + BOTH_DAYS_SHARE) / 2
    print(f"Capacity: day-1 peak if 2025 pattern {peak_unbal:,.0f} | if days balanced {peak_bal:,.0f} | "
          f"cap {CAP_PER_DAY}/day -> max unique {2*CAP_PER_DAY/(1+BOTH_DAYS_SHARE):,.0f}")
    return unique


if __name__ == "__main__":
    print(f"2025 baseline: {ATT_2025} unique attendees, ₹{SPEND_2025} spend")
    for n, p in SCEN.items():
        run(n, p)
