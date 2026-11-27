# CampusFest Growth Center: Attendee Growth (Challenge A)

**RISA Labs Growth APM assignment, by Sai Prasad Bathula (IIT Madras)**

This submission has two parts:

- **The strategy** (a 3-slide deck) sets a target for CampusFest 2027 in Bengaluru: **3,000 unique attendees as the base case and 4,800 as the stretch target, against 2,050 in 2025.**
- **The Growth Center** is a working web app that measures the funnel, diagnoses campaigns, supports decisions and manages execution. It includes an **AI copilot** that answers questions from the app's live data and turns its recommendations into tasks after you confirm them.

| Deliverable | Where |
|---|---|
| 3-slide strategy PDF | [`docs/CampusFest-2027-Growth-Strategy.pdf`](docs/CampusFest-2027-Growth-Strategy.pdf) |
| Working product | **Live: https://campusfest-growth-center-virid.vercel.app** · code: https://github.com/bsaiprasad13-main/campusfest-growth-center · run locally: see [Setup](#7-setup) |
| Strategy model (all Slide 1–2 numbers) | [`docs/strategy_model.py`](docs/strategy_model.py) |
| Metrics engine (all dashboard numbers) | [`src/lib/engine.ts`](src/lib/engine.ts) |
| AI copilot | [`src/lib/copilot/`](src/lib/copilot) |

### Reviewer quick start (3 minutes)
1. **Overview:** 2025 baseline. 2,050 unique attendees against a 2,200 target; 875 registrants never came.
2. **Campaigns:** each channel's Scale / Change / Stop call with its reasons. Paid Social and Creators are Stop at ₹274 and ₹337 per attendee.
3. **Bets & signals** (the 2027 plan): the deck's five bets. Type a weekly signal and the label changes live. Click **Make this a task** on a Stop bet, and the task appears in **Tasks**.
4. **Copilot** (orange button): ask *"Which 2027 bet has crossed a stop line? Draft a task for it."* It reads the data through tools, shows how it got the answer, and saves the task only after you click **Confirm**.
5. **Change the data:** edit a spend row on a campaign page, or the budget or venue cap on Bets & signals, and every number and copilot answer updates. **Data & audit → Reset** restores the original dataset.

Every figure here is tagged:
- **[D]**: computed from the supplied 2025 dataset.
- **[S]**: from a cited outside source.
- **[A]**: our own assumption, with the reason given.

---

## Contents
1. [How the brief maps to this submission](#1-how-the-brief-maps-to-this-submission)
2. [The data and how it is counted](#2-the-data-and-how-it-is-counted)
3. [Strategy: research, assumptions and calculations](#3-strategy-research-assumptions-and-calculations)
4. [The product](#4-the-product)
5. [The AI copilot](#5-the-ai-copilot)
6. [Testing](#6-testing)
7. [Setup](#7-setup)
8. [Tools used, reused and verified](#8-tools-used-reused-and-verified)
9. [Known limitations](#9-known-limitations)
10. [Corrections made during the work](#10-corrections-made-during-the-work)
11. [Sources](#11-sources)

---

## 1. How the brief maps to this submission

| Brief requirement | Where it is answered |
|---|---|
| Choose a Tier 1 city and justify it | Deck Slide 1, "Why Bengaluru"; §3.1 |
| Target audiences, sizes, priority | Slide 1, audience table; §3.2 |
| Funnel reach → registrations → attendees, conversions, costs, capacity | Slide 1, funnel table + capacity; §3.4 |
| Base case and stretch target | Slide 1 (3,000 / 4,800 / ceiling 5,900); §3.4 |
| Five ranked strategies with contribution, budget, timeline, test, KPIs | Slide 2; §3.5 |
| Prioritization framework, double down, reject | Slide 2; §3.5 |
| Risks, early signals, scale/change/stop thresholds, actions | Slide 3; §3.6 |
| Show how the dashboard and AI help these decisions | App: **Bets & signals** (live label per bet, pace, forecast, day-1 peak vs cap, one-click task); copilot tool `get_plan_2027` |
| Measure: funnel, campaign KPIs, targets vs actuals, budget, projection | App: **Overview**, **Campaigns** |
| Diagnose: winners, laggards, bottlenecks, drivers | App: **Diagnose**, campaign pages |
| Support decisions: prioritise, allocate, scale/change/stop | App: **Budget & rules** (simulator + editable rules), **Bets & signals**, live decision labels |
| Manage execution: campaigns, tasks, owners, deadlines; changes update analytics | App: **Tasks**, campaign pages (editable plans and daily rows), **Data & audit** |
| AI copilot grounded in live data, with diagnosis, recommendations, execution and honesty about limits | Copilot side panel; §5 and §6.2 |
| "We may test your product by changing campaign data or constraints" | Campaign plans, daily spend rows, targets, rules, bet readings and thresholds, the budget and the venue cap are all editable; everything recalculates (§4) |
| README: research, assumptions, calculations, sources, framework, setup, tools, limitations | This file |

---

## 2. The data and how it is counted

**Source:** the supplied *Attendee Growth Dataset* covers **CampusFest 2025**, a fictional two-day event held 12–13 April 2025. Its records run from 15 January to 20 April 2025. The original file is kept unchanged at `data/original/Attendee Dataset.xlsx`.

[`scripts/convert_dataset.py`](scripts/convert_dataset.py) converts it to `data/seed/*.json` with **no cleaning**, so duplicates stay in. The cleaning happens at query time in the engine. That means the same rules also apply to data that is edited later.

### 2.1 Counting rules (from the dataset's own "Read me", applied to every number)
1. **Duplicates:** an ID that appears more than once is an import copy and counts once. Removed: 2 daily marketing rows, 4 status-history rows, 20 check-ins.
2. **External people only:** only `person_type = external` counts toward targets. Internal, staff and test people are excluded (40 of them had admissions).
3. **Attendee:** a **distinct external person** with an `admitted` **and** `verified` check-in. Someone who came on both days counts once. Denied, pending and unverified check-ins don't count.
4. **Registration status:** the latest status version at or before the selected date.
5. **Snapshot dates:** a selected date means **the end of that day in IST**, and nothing later is used. The whole app (and the copilot) can be viewed "as of" any date.
6. **Traffic counts aren't people:** impressions, clicks, reach, sessions and form starts are anonymous event counts. Summing them doesn't give unique people.
7. **Spend is net:** vendor credits appear as negative rows (4 of them) and are netted in.
8. **Attribution:** an attendee is credited to the campaign recorded on their registration. In this data that always matches their first campaign. Walk-ins have no campaign.

### 2.2 2025 baseline (cleaned) [D]

| Funnel stage | 2025 |
|---|---|
| Impressions / clicks / landing sessions / form starts | 10,29,015 / 32,070 / 24,645 / 5,548 |
| Identified external people | 3,625 (3,500 from campaigns + 125 walk-ins) |
| Registrations (external) | 2,800 |
| Confirmed at the end | 2,500 |
| **Unique verified attendees** | **2,050** (1,925 registered + 125 walk-ins) |
| Came on both days | 725 (35%) |
| Unique attendees on day 1 | 1,430 (70%) |
| Marketing spend | ₹2,74,000 (₹134 per attendee) |

**Against the revised targets (set 15 March 2025):**
- Identified people: 3,625 vs 3,600. Hit.
- Registrations: 2,800 vs 3,200. Missed, at 87.5%.
- Attendees: 2,050 vs 2,200. Missed, at 93.2%.
- Budget: ₹2,74,000 used of ₹3,00,000, leaving ₹26,000 unspent.

| Campaign | Spend | Registrations | Attendees | Registrants who came | ₹ per attendee |
|---|---|---|---|---|---|
| Student Referrals | ₹19,000 | 350 | 275 | 78.6% | ₹69 |
| Organic Search | ₹14,000 | 250 | 195 | 78.0% | ₹72 |
| College Partnerships | ₹31,000 | 450 | 385 | 85.6% | ₹81 |
| Community Groups | ₹16,000 | 200 | 165 | 82.5% | ₹97 |
| Campus Ambassadors | ₹42,000 | 520 | 390 | 75.0% | ₹108 |
| Paid Social | ₹93,000 | 680 | 340 | 50.0% | ₹274 |
| Creator Partners | ₹59,000 | 350 | 175 | 50.0% | ₹337 |

### 2.3 Insights that drive the strategy [D]
- **Spend went to the least efficient channels.** Paid Social and Creators took 56% of spend but delivered 25% of attendees.
- **Peer and group channels turn registrants into attendees:** 79–86% of registrants from referrals, college partnerships and community groups came (ambassadors: 75%), against 50% for paid channels.
- **875 registrants never came:**
  - 575 confirmed but didn't show up
  - 183 cancelled
  - 88 were waitlisted and never admitted
  - 29 never confirmed
- **Engagement predicts attendance; email doesn't:**
  - Brochure downloaders came **+12.8 points** more often (74.7% vs 61.9%).
  - People who asked a question came **+11.4 points** more often.
  - People who opened an email came at the same rate as those who didn't (+0.2).
- **Email fatigue is real:** 13% of the people who were emailed opted out (178 of 1,400). In total 229 people opted out; 51 of them were never emailed.

---

## 3. Strategy: research, assumptions and calculations

### 3.1 City: Bengaluru
- Bengaluru Urban has **1,106 colleges**, the most of any district in India [S: AISHE, via Deccan Herald and Statista].
- Using Karnataka's average of **433 students per college** [S: AISHE 2023-24], that's roughly **4.8 lakh students** [A: likely an undercount, since Bengaluru's colleges are larger than average].
- It's one dense metro, so trips are short, which helps people show up.

### 3.2 Target audiences
| Priority | Segment | Size | Why |
|---|---|---|---|
| P1 | Students at about 40 partner colleges | ~1 lakh [A: ~2,500 per large college] | Referrals and college partners: 79–86% of registrants came, at ₹69–81 per attendee [D] |
| P2 | Other Bengaluru students | ~3.8 lakh | Reached through organic search, community groups and retargeting |
| P3 | Young professionals aged 22–27 | Large | Only as friends of registrants, via crew passes |
| Avoid | Out-of-city students | – | Travel risk [A]. The data has no city field, so this can't be tested |

### 3.3 Planning assumptions [A]
| Assumption | Value | Why |
|---|---|---|
| Framing | The 2025 data is last year's edition; we plan **CampusFest 2027** for 10–11 April 2027 | Every conversion rate can then come from history, not guesses. A "2026" edition would already be in the past. |
| Budget and time | ₹5L, 10 weeks (1 Feb to 11 Apr) | About 1.7x 2025: a realistic step up, not a 10x jump |
| Venue capacity | 4,000 people per day | 88 waitlisted people in 2025 hint at a limit; a stated cap keeps the stretch honest |
| Entry | Free registration with a QR pass | The data has no ticket price |
| Day-2 act | Sponsor-funded, outside the ₹5L | Keeps the marketing budget for acquisition |
| Diminishing returns | Cost per registration × (new spend ÷ old spend)^e, with e = 0.4 (base) or 0.25 (stretch) | **Pure judgment, the least data-backed number in the model.** Each channel has only one year of data, so the data can't show how costs scale. |

### 3.4 The model (Slide 1) — [`docs/strategy_model.py`](docs/strategy_model.py)

**How it works, for each channel:**
1. Registrations = spend ÷ cost per registration.
2. Cost per registration = the 2025 cost × (new spend ÷ 2025 spend)^e, applied only when spend rises.
3. Attendees = registrations × that channel's 2025 share of registrants who came.

On top of that, crew friends and walk-ins are added.

**Spend allocation:**
- Peer channels: Referrals ₹80k, College Partnerships ₹1.1L, Ambassadors ₹90k.
- Always-on: Organic ₹25k, Community ₹35k.
- Capped: Paid Social ₹40k (retargeting only), Creators ₹20k (paid per registration).
- New bets: show-up engine ₹60k, walk-in capture ₹40k.

| | 2025 [D] | 2027 base [A] | 2027 stretch [A] |
|---|---|---|---|
| Reach (impressions) | 1.03M | 1.12M | 1.28M |
| Identified via campaigns | 3,500 | 4,378 | 5,037 |
| Registrations | 2,800 | 3,698 | 4,270 |
| Registrants who came | 69% | 77% | 87% |
| Registered attendees | 1,925 | 2,836 | 3,736 |
| + friends on crew passes | – | – | 583 |
| + walk-ins | 125 | 181 | 480 |
| **Unique attendees** | **2,050** | **3,017** | **4,799** |
| ₹ per attendee | ₹134 | ₹166 | ₹104 |

**Base case: 3,000 (1.5x; the model gives 3,017).** This comes from moving the budget to peer channels alone, at 2025 rates, with no new levers. The share of registrants who come rises from 69% to 77% only because money moves to channels where more registrants came. Each attendee above 2025 costs ₹234: ₹2.26L more spend for 967 more attendees. That's diminishing returns stated openly.

"Identified via campaigns" counts people who gave their details through a campaign. The 125 walk-ins were identified only at the gate, which is why the Overview's total of identified people is 3,625.

**Stretch: 4,800 (2.3x; the model gives 4,799), on the same ₹5L.** The bridge from base to stretch shows what must go right:

| Step | Attendees |
|---|---|
| Base case | 3,017 |
| Costs rise more slowly as spend grows (e = 0.25 instead of 0.4, all channels) | +463 |
| Show-up engine (registrants who came +8 points, capped at 92%; waitlist recovered) | +437 |
| Crew passes (15% of non-referral registrants × 1.5 friends × 80% come; referral registrants are left out to avoid double counting) | +583 |
| Walk-ins rise from 6% to 10% | +299 |
| **Stretch** | **4,799** |

**Capacity:**
- The ceiling is 4,000 per day [A] × 2 days ÷ 1.35 visits per person = **about 5,900 unique attendees** (5,926 with 1.35 rounded; 5,910 with the exact 725 ÷ 2,050). The 1.35 comes from 35% of attendees coming on both days [D].
- At 2025's day split (70% of attendees present on day 1), the stretch target puts about **3,347 people on day 1**, which is 84% of the cap.

**Weakest assumption: the crew loop.** It's tested first (Slide 3).

**Sensitivity to the least data-backed assumption** (the diminishing-returns exponent e; everything else unchanged):

| e | Base | Stretch levers with this e |
|---|---|---|
| 0.25 | 3,509 | 4,799 |
| **0.40 (base)** | **3,017** | 4,146 |
| 0.60 | 2,483 | 3,434 |
| 1.00 | 1,719 | 2,410 |

If costs rise faster than assumed, the base falls towards 2,500. That is why Slide 3's pace rule checks registrations against the 2025 curve at week 3 and moves money before it's too late.

### 3.5 Prioritization (Slide 2)

**Framework:** each bet is scored 1–5 on five criteria, weighted:
- Impact (extra attendees): 30%
- Strength of evidence in the 2025 data: 25%
- ₹ per extra attendee: 20%
- Speed to impact: 15%
- Risk and dependency: 10% (a higher score means lower risk)

| Rank | Bet | Impact / Evidence / Cost / Speed / Risk | Score | Extra attendees, base / stretch | Budget | ₹ per extra attendee |
|---|---|---|---|---|---|---|
| 1 | Bring-Your-Crew referrals | 5 / 3 / 5 / 4 / 3 | 4.15 | +377 / +1,117 | ₹80k | ₹72 |
| 2 | Show-up engine | 3 / 4 / 5 / 5 / 4 | 4.05 | 0 / +437 | ₹60k | ₹137 |
| 3 | College Squad Passes | 4 / 5 / 3 / 3 / 3 | 3.80 | +438 / +610 | ₹1.1L | ₹180 |
| 4 | Ambassadors paid per verified attendee | 3 / 4 / 3 / 4 / 4 | 3.50 | +226 / +301 | ₹90k | ₹299 |
| 5 | Walk-in capture + day-2 hook | 3 / 2 / 4 / 2 / 2 | 2.70 | +56 / +355 | ₹40k | ₹113 |
| – | Always-on (organic search, community) | – | – | +180 / +238 | ₹60k | – |
| – | Capped (paid social, creators) | – | – | −310 / −310 | ₹60k | – |

**Check:** the contributions add up to +967 (base) and +2,749 (stretch), which equal 3,017 − 2,050 and 4,799 − 2,050. The budget adds up to ₹5.0L.

**Rejected, with evidence:**
- Broad Paid Social prospecting: ₹274 per attendee, and only half of registrants came [D].
- Flat-fee creator deals: ₹337 per attendee [D].
- More nurture email: openers came no more often [D].
- A refundable deposit: payers come only 2–4 points more often [S: Pheedloop].
- Out-of-city outreach.
- A celebrity paid from the marketing budget.

### 3.6 Thresholds (Slide 3)
Each bet has an early signal and numeric **scale / change / stop** lines, checked at gates in weeks 3, 6 and 9. **Scale line = the model's assumption for that bet is holding; stop line ≈ half of it.** For example, the model assumes 15% of registrants bring a friend, so the crew loop scales at 15% or more and stops below 8% at week 3. For college squads, 40 colleges × 25 registrations ≈ the 1,000 squad registrations the model assumes (962 in the base case).

**Pace rule [D]:** in 2025, 30 / 46 / 65 / 90% of registrations had arrived by weeks 3 / 5 / 7 / 9, counting back from fest week (week 10). Applied to the ~3,700 registrations in the base plan, the checkpoints are 1,110 / 1,700 / 2,400 / 3,330. Below 85% of a checkpoint, budget is reallocated. A day-1 forecast above 3,600 (90% of the cap) triggers day-specific passes.

All of this runs live on the app's **Bets & signals** page (§4).

---

## 4. The product

Next.js app. The menu has three groups: **2025 results** (the evidence), **2027 plan** (the deck's bets, tracked live) and **Run it** (tasks and the audit trail). A date picker in the header sets **"Data as of end of"** for the 2025 pages and the copilot.

| Page | What it does |
|---|---|
| **Overview** | KPIs vs the targets in force (attendees, registrations, identified people, budget); the two-part funnel (anonymous traffic, then people identified via campaigns → registered → attended, plus walk-ins); registrations vs the target pace; a run-rate projection before the event or actuals after; why registrants were lost; a summary of the counting rules applied |
| **Campaigns** | A per-campaign table: spend, budget used, identified, registered, attended, ₹ per registration, ₹ per attendee, share who came, the **Scale / Change / Stop** call (hover for reasons), and the weakest stage vs average. Also lets you create campaigns. |
| **Campaign page** | Edit the plan (status, planned budget, owner, notes); add and edit tasks; **edit, add or delete daily marketing rows**; a daily chart; stage conversion vs all campaigns |
| **Diagnose** | A stage-conversion heatmap vs the all-campaign rate; spend share vs attendee share; which engagement actions predict showing up; each campaign's bottleneck |
| **Budget & rules** | A budget reallocation simulator (the same formulas as the deck's model, fed live campaign data, with assumption sliders; at actual spend it reproduces the actual 2,050); **editable scale/change/stop rules** that re-classify campaigns immediately; new target versions with effective dates |
| **Bets & signals** (2027 plan) | The deck's five bets with budget, owner role and weeks. Type each bet's weekly signal and get a live **Scale / Change / Stop** label from Slide 3's lines (editable). Slide 3's second condition for each bet (e.g. "scale only if ₹ per registration ≤ ₹80") is shown beside the label as "Also check". Each row also has the next action and a **Make this a task** button. Also shows registration pace against the 2025 curve, the attendance forecast, the day-1 peak against the venue cap, and a budget check that says what to cut if the budget shrinks. The budget, venue cap and planned registrations are editable constraints. It ships with a **simulated week-3 example**, clearly labelled, so every label can be seen working |
| **Tasks** | Create, edit, filter and close tasks (owner, campaign, due date, priority, status); overdue tasks are highlighted; tasks from the copilot are labelled |
| **Data & audit** | Source and storage details, the counting rules, a change log of every edit, and **reset to the original dataset** |

**Saved changes update everything.** Every write goes through validated API routes ([`src/lib/mutations.ts`](src/lib/mutations.ts)) and is recorded in the change log. Every page and the copilot recalculate from the stored data.

**Scale / Change / Stop rules for 2025 campaigns** (editable defaults in Budget & rules):
- **After the event:** Scale if cost per attendee is ₹100 or less **and** at least 75% of registrants came. Stop if cost per attendee is ₹200 or more **or** fewer than 55% came. Otherwise Change.
- **Before the event:** Scale if cost per registration is ₹80 or less. Stop if it's ₹150 or more. Otherwise Change.
- A campaign with fewer than 20 registrations is marked "not enough data".

**Storage** ([`src/lib/store.ts`](src/lib/store.ts)):
- The original dataset ships read-only with the app.
- Edits are stored as *overrides* (campaigns, daily rows, targets) plus the app's own records (tasks, plans, rules, audit log).
- Backends: **Supabase** (a `kv` table, [`supabase/schema.sql`](supabase/schema.sql)) when configured, otherwise local JSON files in `data/store/`.

### Suggested walk-through (insight → action)
1. **Overview:** attendees 2,050 vs a target of 2,200, and 875 registrants lost.
2. **Campaigns:** Paid Social and Creators are marked **Stop** (₹274 and ₹337 per attendee, half of registrants came).
3. **Diagnose:** Paid Social's weakest stage is impressions → clicks (2.1% vs 3.1%). Brochure downloads predict attendance.
4. **Budget & rules:** move ₹30k from Creators to Referrals. The simulator shows about +129 attendees.
5. **Bets & signals:** Bet 4 (ambassadors) reads 0.8 registrations per ambassador per week, below its stop line of 1, so it is labelled **Stop**: "drop the bottom half; move the money to Bet 3". Click **Make this a task**. Type 16 for Bet 1 and it turns to **Scale**.
6. **Copilot:** *"Create a task for the Creator Partners owner to switch creator deals to pay-per-registration, due 2025-03-10."* It drafts the task, you click **Confirm**, and it appears in **Tasks**, tagged "created via copilot".
7. **Change data and see it update:** on a campaign page, add ₹50,000 to a Paid Social daily row. The spend KPIs, the campaign's ₹ per attendee and the copilot's answers all update.
8. **Data & audit:** every change is logged. **Reset** restores the original data.

---

## 5. The AI copilot

### 5.1 Design
The copilot is a tool-calling agent ([`agent.ts`](src/lib/copilot/agent.ts)). The language model never sees raw tables: it asks for numbers through **12 tools** ([`tools.ts`](src/lib/copilot/tools.ts)) that run the **same engine as the dashboard** on the currently stored data.

| Tool | Purpose |
|---|---|
| `get_data_dictionary` | Tables, fields, counting rules, and an explicit **not in the data** list (college, city, demographics, revenue, ticket price, satisfaction, capacity, multi-touch attribution…) |
| `get_overview` | Totals, targets in force, progress, budget, projection, lost registrations, data quality |
| `get_campaigns` | Per-campaign metrics, the official scale/change/stop decision and its reasons, bottleneck; single-campaign detail with plan and tasks |
| `get_diagnostics` | Stage rates vs average, spend vs attendee share, engagement drivers |
| `get_timeseries` | Daily or weekly series for 8 metrics, optionally per campaign |
| `query_records` | **A flexible filter/group/aggregate tool** over the cleaned person-level tables, for questions nobody anticipated |
| `get_tasks` | Tasks, open and overdue counts |
| `get_plan_2027` | The 2027 bets with their readings, thresholds, live labels, second checks and next actions; pace, forecast, day-1 peak vs cap, budget; the day-1 load if the base or stretch target is hit. Accepts a what-if cap or budget (not saved). Says when the readings are the simulated example |
| `simulate_budget` | The planner's model, labelled as an estimate |
| `calculate` | **An exact calculator** (a safe expression parser, no `eval`) |
| `propose_task`, `propose_campaign_update` | **Draft** an action. Nothing is saved until the user clicks **Confirm** in the chat. |

### 5.2 Guardrails
- **Grounding is enforced by the API, not just requested.** The first step of every answer *must* be a tool call (`tool_choice: required`, or Gemini's `mode: ANY`). Without this, a model was seen inventing funnel numbers.
- **The system prompt requires:**
  - every number, campaign and rate comes from a tool result in the conversation
  - arithmetic goes through `calculate`
  - answers label **Evidence / Assumption / Recommendation**
  - when the data can't answer, the copilot says so *first*, names what's missing and offers the closest question it can answer
  - "why" questions are answered with what the data shows, not invented causes
  - scale/change/stop answers report the *official* rule-based decision
- **Phase-aware:** after the 2025 event, it frames findings as lessons for the 2027 bets instead of "stop spending now".
- **Names only what the tools returned:** no generic channels (e.g. "email" or "influencers" as campaigns) that are not in the data.
- **Task requests become real drafts:** if a model writes a task as text instead of drafting it, the agent asks once more for the draft, so there is always a **Confirm** button.
- **Simulated data is always flagged:** if an answer uses the example 2027 readings and doesn't say so, the agent adds the note itself.
- **The copilot can't write data itself.** It only drafts proposals; saving goes through the normal API after the user confirms.
- **Transparency:** every answer shows a "How I got this" panel listing each tool call with its arguments and result, plus the model and token count used.

### 5.3 Providers and resilience
[`providers.ts`](src/lib/copilot/providers.ts) supports any **OpenAI-compatible** API and **Gemini**.

**Default order:**
1. Groq `openai/gpt-oss-120b`
2. Groq `openai/gpt-oss-20b`
3. Gemini (if a key is set)

**Resilience rules:**
- If a model is busy, out of quota or not offered to the key, the copilot moves to the next one.
- Short per-minute rate limits are waited out (up to 15 s) rather than downgrading the model.
- Every call has a timeout, and each answer has a 55-second deadline (inside Vercel's 60-second limit). If time runs out, it says so plainly instead of spinning.
- Optional tool arguments accept `null`, and a malformed tool call (a 400 from the provider's schema check) is retried on the same model, because it is random.
- When every model is briefly rate-limited, the chat shows "busy, retrying in N s" and **retries once automatically**. Technical details stay folded away under each error.
- The "How I got this" panel shows which model answered and any model it fell back from.

**Why Groq:**
- Gemini's free tier for this key allowed only **20 requests per day** per model, and `gemini-2.5-flash` is retired for new keys. During testing the quota ran out after about 8 questions.
- Groq's free tier (as reported by its API headers for this key) allows **1,000 requests per day and 8,000 tokens per minute** per model.
- Tool descriptions and results were trimmed so a typical answer uses about **4,000–5,000 tokens** (down from about 8,300).

---

## 6. Testing

### 6.1 Automated tests (22, `npm test`)
- **Engine** ([`engine.test.ts`](src/lib/engine.test.ts)):
  - the deduplication counts
  - 3,625 / 2,800 / 2,050 / 1,925 / 125 / 725, ₹2,74,000, 575 no-shows, 40 excluded admissions
  - target versions over time
  - per-campaign costs and decisions
  - no future data in past snapshots: day 1 gives 1,430 attendees; before the event, 0
  - the planner reproducing actual results at actual spend
- **Copilot tools** ([`tools.test.ts`](src/lib/copilot/tools.test.ts)):
  - calculator correctness and rejection of non-arithmetic input
  - `query_records` gives 2,050 distinct verified external attendees, rejects unknown fields like "college", and respects the snapshot date
  - time-series totals match the snapshot
  - the simulator spends the same total
  - proposals never save
  - `get_plan_2027` returns five bets with live labels and flags the simulated readings, and answers a what-if venue cap without saving it
- **2027 plan** ([`plan2027.test.ts`](src/lib/plan2027.test.ts)):
  - labels follow the scale/stop lines
  - the pace curve reproduces 1,110 / 1,702 / 2,405 / 3,330 at weeks 3 / 5 / 7 / 9
  - the shipped example gives Change / Scale / Stop, a balanced ₹5L budget, on-track pace and a ceiling of 5,926
  - changed constraints: a smaller budget names Bet 5 as the first cut, slow pace says "behind", and a smaller venue cap raises the day-1 alert
  - bad input is rejected with readable messages
- **Engine:** 3,500 people identified via campaigns + 125 walk-ins = 3,625

The expected values were computed **independently in Python/pandas** from the original xlsx.

### 6.2 Copilot test battery (live model, at a human pace)
| Test | Result |
|---|---|
| Which campaigns to scale/change/stop? | Matches the official rule-based calls and reasons |
| Follow-up: "for the worst one, where does it lose people?" | Resolved "the worst one" to Creator Partners and found its funnel |
| % of the attendee target, and the gap | 93.2%, 150 short (via `calculate`) |
| "Which college sent the most attendees?" | "The data does not contain any information about colleges…", then offered the closest answerable question |
| Snapshot of 1 March 2025 | 1,144 of 2,800 (40.9%), run-rate projection 2,815, labelled as assumptions |
| Manual vs scanner check-ins (an unusual question) | 305 / 2,945 via `query_records` (recovered from a wrong field name on its own) |
| Move ₹30k from Creators to Referrals | +129 attendees, labelled a model estimate |
| "Create a task for the Paid Social owner…" | Drafted with the right owner (Arjun Verma), due date and priority; saved only after Confirm |
| After adding ₹50k to a Paid Social row | ₹3,24,000 spent, ₹24,000 over budget, ₹421 per attendee |
| "Was it the creative?" | "The data does not capture creative quality, so we cannot confirm…" |

### 6.3 Manual checks
- Every page rendered and checked against the Python numbers.
- Edits checked: a ₹10,000 spend edit moved Paid Social from ₹274 to ₹303 per attendee.
- Bad input returns clear 400 errors.
- The confirm-to-task flow was clicked through in the UI.
- Reset restores the original data.
- The production build (`next build`) passes.

### 6.4 Independent review before submission
Two separate AI reviewers were given only the brief, the deck PDF, the README and the live link. They used different models, different roles and no shared context: one was a line-by-line brief auditor that recomputed 48 numbers from the raw xlsx, and the other was a hiring manager testing the live product. Their findings were checked against the data before anything was changed. What was fixed is listed in §10. A third reviewer then re-checked all 22 findings against the live site: 13 fixed, 8 partly fixed, none open, and one (open write endpoints) kept by design. Its remaining points were also addressed: the second checks above, a stretch-target capacity check and what-if cap in the copilot, plain-text formulas, and the rounding notes on the slides.

---

## 7. Setup

Requirements: Node 20+ (tested on Node 24).

```bash
npm install
cp .env.example .env        # then paste at least one AI key (see below)
npm run dev                 # http://localhost:3000
npm test                    # 22 tests
npm run build && npm start  # production build
```

**Environment variables** (`.env`, git-ignored):

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Main copilot provider (free key: console.groq.com/keys) |
| `GROQ_MODELS` | Default `openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `GEMINI_API_KEY`, `GEMINI_MODELS` | Optional backup provider |
| `LLM_PROVIDERS` | Order to try providers in, default `groq,gemini` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Optional durable storage; run `supabase/schema.sql` once |

**Without an AI key,** everything except the copilot works, and the copilot explains what's missing. **Without Supabase,** edits are saved to `data/store/`.

**Deploying (Vercel):**
1. Import the repository.
2. Set the variables above.
3. Use Supabase for storage (run `supabase/schema.sql` in the same project the Vercel variables point to). Vercel's file system is temporary, and the app says so in its sidebar if Supabase isn't set.

The seed data is bundled through `outputFileTracingIncludes` in `next.config.ts`.

To regenerate the seed from the xlsx:

```bash
python scripts/convert_dataset.py "data/original/Attendee Dataset.xlsx" data/seed
```

---

## 8. Tools used, reused and verified

| Tool | Use | Plan |
|---|---|---|
| Next.js 15, React 19, TypeScript, Tailwind CSS 4 | App framework and UI. Scaffolded with `create-next-app`; everything else written for this project. | Free / open source |
| Recharts 2.15 | Charts | Open source |
| Supabase JS client | Optional storage backend | Free tier |
| Groq API (`openai/gpt-oss-120b`, `gpt-oss-20b`) | Copilot language models | Free tier |
| Google Gemini API | Optional backup models | Free tier |
| Vitest | Tests | Open source |
| Python + pandas + openpyxl | Dataset conversion and independent checks of every expected number | Open source |
| Claude (Anthropic), via Claude Code | AI pair-programmer and analyst: helped analyse the data, draft the strategy and deck, and write and test the code | – |

**What was verified by hand:**
- Every metric against an independent pandas calculation.
- Every copilot test answer against the data.
- The deck numbers against `docs/strategy_model.py`.

---

## 9. Known limitations
- **Synthetic, single-year data.** The diminishing-returns exponent, the crew loop, the show-up uplift and the walk-in share are assumptions, not observed. The planner labels them and lets you change them.
- **Attribution is single-touch** (the registration's campaign). Overlap between campaigns can't be measured.
- **Engagement drivers are correlations,** not proof of cause.
- **College-level metrics aren't possible** (there's no college field). A real 2027 run would need one to track Slide 3's per-college threshold.
- **The projection is a simple run-rate** with assumed rates of showing up and walking in (editable).
- **Person-level tables are read-only in the app.** Campaigns, daily marketing rows, targets, plans, tasks and rules are editable.
- **Copilot:**
  - Free-tier rate limits allow about two questions a minute; faster bursts may briefly fail with a clear message.
  - The backup model (`gpt-oss-20b`) is weaker and can make small slips, which is why every answer shows its data look-ups.
  - Answers are generated, so their wording varies between runs.
- **The 2027 readings are an example** until the team types real ones; the app and the copilot label them as simulated.
- **Base-case sensitivity:** the base depends most on the diminishing-returns exponent (§3.4 table). The pace rule is the safeguard.
- **Open by design:** there are no logins, so reviewers can change data and constraints as the brief suggests. Anyone with the link can also press Reset, which restores the original dataset.
- **One process, no logins.** Concurrent edits from many users aren't coordinated beyond one write at a time per process.
- **Next.js dev overlay:** a browser extension that adds attributes (e.g. `fdprocessedid`) can trigger a harmless "hydration mismatch" notice. It appears only in development.

## 10. Corrections made during the work
- **Day-1 attendance:** an early draft counted 1,905 day-1 check-in *records* as people (93%). The tested engine shows **1,430 distinct people (70%)**. The deck was corrected: the stretch target's day-1 peak is about 3,350, within the cap, and Bet 5 was reframed as walk-in capture.
- **Gemini model and quota:** `gemini-2.5-flash` is retired for new keys, and the free quota was too small, hence the switch to Groq.
- **Grounding:** one backup model answered without tools and invented numbers. Required tool calls on the first step, and removing that model, fixed it.
- **After the independent review (§6.4):**
  - Email opt-out was stated as 16%. It is **13% of emailed people** (229 opt-outs ÷ 1,400 emailed counted 51 people who were never emailed).
  - The venue cap (4,000 a day) was tagged as data; it is an **assumption** and is now tagged [A].
  - The crew formula now says **non-referral** registrants, which is what the model uses.
  - "Identified people" meant 3,500 on the slide and 3,625 on the Overview. Both now say what they count: **identified via campaigns (3,500)**, plus 125 walk-ins identified at the gate.
  - The simulator showed 2,048 at actual spend (6% walk-in assumption vs the actual 6.1%). It now defaults to the actual share and shows **2,050**.
  - Out-of-city claims are now labelled as untested assumptions (the data has no city field).
  - Slide 2 now shows each bet's five criterion scores, and its last row shows both base and stretch.
  - Slide 3 now says where the thresholds come from, defines its terms, and describes the dashboard as it is built.
  - The copilot showed raw provider errors and sometimes failed on a malformed tool call. See §5.3 for the fixes.
  - The deck promised a live label per bet; the **Bets & signals** page now provides it.

## 11. Sources
- Deccan Herald, *Bangalore Urban district tops list with highest number of colleges* (AISHE): https://deccanherald.com/india/bangalore-urban-district-tops-list-with-highest-number-of-colleges-1186213.html
- Deccan Herald, *Karnataka continues to record highest college density* (AISHE 2023-24, 433 students per college): https://www.deccanherald.com/education/karnataka-continues-to-record-highest-college-density-in-india-past-5-years-aishe-report-4067791
- Statista, *Number of colleges in India by district (2022)*: https://statista.com/statistics/1063133/india-number-of-colleges-by-major-district
- Pheedloop, *Event Data Lab Report #05*, no-show rates for free vs paid events: https://pheedloop.com/blog/event-data-lab-report-5
- Mood Indigo and Saarang attendance (category ceiling only, unaudited): https://en.wikipedia.org/wiki/Mood_Indigo_(culfest), https://en.wikipedia.org/wiki/Saarang
- Groq rate limits: read from the API's `x-ratelimit-*` response headers for this key (November 2026).
