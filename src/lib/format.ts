export const inr = (n: number | null | undefined, digits = 0) =>
  n == null ? "–" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
export const num = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-IN"));
export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "–" : `${(n * 100).toFixed(digits)}%`);
export const STAGE_LABEL: Record<string, string> = {
  ctr: "Impressions → clicks",
  click_to_session: "Clicks → page sessions",
  session_to_reg_start: "Sessions → form starts",
  identified_to_registered: "Identified → registered",
  registered_to_confirmed: "Registered → confirmed",
  registered_to_attended: "Registered → attended",
};
export const DECISION_STYLE: Record<string, { label: string; cls: string }> = {
  scale: { label: "Scale", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  change: { label: "Change", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  stop: { label: "Stop", cls: "bg-orange-100 text-orange-900 border-orange-400" },
  insufficient_data: { label: "Not enough data", cls: "bg-stone-100 text-stone-700 border-stone-300" },
  no_reading: { label: "No reading yet", cls: "bg-stone-100 text-stone-700 border-stone-300" },
};
export const PHASE_LABEL = { pre_event: "Before the event", during_event: "During the event", post_event: "After the event" } as const;
