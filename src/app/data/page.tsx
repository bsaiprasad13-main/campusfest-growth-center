"use client";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, Card } from "@/components/ui";
import { num } from "@/lib/format";

export default function DataPage() {
  const { state, mutate } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  if (!state) return null;
  const s = state.snapshot;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Data & audit</h1>
        <p className="text-sm text-slate-500">What the numbers are built from, what has been changed, and a way back to the original dataset.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Source and storage">
          <ul className="space-y-1 text-sm text-slate-700">
            <li>Event: <b>{s.event.name}</b>, {s.event.starts_at.slice(0, 10)} to {s.event.ends_at.slice(0, 10)} (fictional, synthetic records)</li>
            <li>History covered: {s.event.history_start} to {s.event.history_end}</li>
            <li>Editable here: campaigns, daily marketing rows, target versions, plans, tasks, rules. Person-level records (people, engagement, registrations, status history, check-ins) are read-only source data.</li>
            <li>Storage backend: <b>{state.storage}</b></li>
          </ul>
          <div className="mt-3">
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm("Reset everything to the original dataset? This removes all edits, tasks and rule changes.")) return;
                try { await mutate("/api/reset", "POST"); setMsg("Reset done: original dataset restored."); } catch (x) { setMsg(String(x)); }
              }}
            >
              Reset to original dataset
            </Button>
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        </Card>

        <Card title="Counting rules applied to every number">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-700">
            <li>Repeated source IDs are import copies and count once ({Object.entries(s.data_quality.duplicates_removed).filter(([, v]) => v).map(([k, v]) => `${v} in ${k}`).join(", ") || "none now"}).</li>
            <li>Only external people count; {num(s.data_quality.excluded_non_external_admissions)} internal / staff / test admissions are excluded.</li>
            <li>An attendee is a distinct external person with an admitted and verified check-in. Two days of entry = one attendee.</li>
            <li>Registration status is the latest version on or before the selected date.</li>
            <li>A selected date means the end of that day in IST. Nothing later is used.</li>
            <li>Reach, impressions and clicks are event counts, not unique people.</li>
            <li>Spend is net of vendor credits ({num(s.data_quality.vendor_credit_rows)} negative rows).</li>
          </ol>
        </Card>
      </div>

      <Card title="Change log" subtitle="Latest 40 changes, newest first">
        {state.audit.length === 0 ? (
          <p className="text-sm text-slate-500">No changes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {state.audit.map((a, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="whitespace-nowrap py-1 pr-3 text-xs tabular-nums text-slate-500">{new Date(a.at).toLocaleString("en-IN")}</td>
                  <td className="pr-3 text-xs">{a.actor}</td>
                  <td className="pr-3 font-medium">{a.action}</td>
                  <td className="text-slate-600">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
