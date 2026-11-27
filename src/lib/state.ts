import { computeSnapshot } from "./engine";
import { listOwners } from "./mutations";
import { getApp, getDataset, storageName } from "./store";
import { defaultPlan2027, evaluatePlan } from "./plan2027";

export async function loadState(asOf?: string | null) {
  const [ds, app] = await Promise.all([getDataset(), getApp()]);
  const ev = ds.event[0];
  let date = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : ev.history_end;
  if (date < ev.history_start) date = ev.history_start;
  if (date > ev.history_end) date = ev.history_end;
  const snapshot = computeSnapshot(ds, app, date);
  return {
    snapshot,
    tasks: app.tasks,
    plans: app.plans,
    settings: app.settings,
    plan2027: evaluatePlan(app.plan2027 ?? defaultPlan2027()),
    plan2027_inputs: app.plan2027 ?? defaultPlan2027(),
    audit: app.audit.slice(0, 40),
    owners: listOwners(ds.campaigns),
    targets_history: ds.targets,
    storage: storageName(),
    ds,
    app,
  };
}

export type LoadedState = Awaited<ReturnType<typeof loadState>>;
export type ClientState = Omit<LoadedState, "ds" | "app">;

export function toClient(s: LoadedState): ClientState {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ds, app, ...rest } = s;
  return rest;
}
