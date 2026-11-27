import fs from "node:fs";
import path from "node:path";
import type { AppState, CampaignPlan, Dataset } from "./types";
import { DEFAULT_SETTINGS, SOURCE_TABLES } from "./types";
import { defaultPlan2027 } from "./plan2027";

export const SEED_DIR = path.join(process.cwd(), "data", "seed");

export function loadSeedDataset(): Dataset {
  const ds = {} as Record<string, unknown>;
  for (const t of SOURCE_TABLES) {
    ds[t] = JSON.parse(fs.readFileSync(path.join(SEED_DIR, `${t}.json`), "utf-8"));
  }
  return ds as unknown as Dataset;
}

export function initialAppState(ds: Dataset): AppState {
  const plans: Record<string, CampaignPlan> = {};
  for (const c of ds.campaigns) {
    plans[c.campaign_id] = { campaign_id: c.campaign_id, status: "active", planned_budget_inr: null, notes: "" };
  }
  return { tasks: [], plans, settings: structuredClone(DEFAULT_SETTINGS), audit: [], plan2027: defaultPlan2027() };
}
