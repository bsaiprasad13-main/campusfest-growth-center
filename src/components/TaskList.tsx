"use client";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { TaskForm } from "./TaskForm";
import { Badge, Button, Empty } from "./ui";
import type { Task } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };

export function TaskList({ tasks }: { tasks: Task[] }) {
  const { state, mutate } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!state) return null;
  const owner = (id: string | null) => state.owners.find((o) => o.owner_id === id)?.owner_name ?? "Unassigned";
  const camp = (id: string | null) => state.snapshot.campaigns.find((c) => c.campaign_id === id)?.campaign_name ?? "–";
  const today = new Date().toISOString().slice(0, 10);

  if (!tasks.length) return <Empty>No tasks yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      {err && <p className="mb-2 text-sm text-orange-700">{err}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs text-slate-500">
            <th className="py-2 pr-2">Task</th><th className="pr-2">Campaign</th><th className="pr-2">Owner</th><th className="pr-2">Due</th><th className="pr-2">Priority</th><th className="pr-2">Status</th><th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) =>
            editing === t.id ? (
              <tr key={t.id} className="border-b border-stone-100"><td colSpan={7} className="py-2"><TaskForm initial={t} onDone={() => setEditing(null)} /></td></tr>
            ) : (
              <tr key={t.id} className="border-b border-stone-100 align-top">
                <td className="py-2 pr-2">
                  <p className={`font-medium ${t.status === "done" ? "text-slate-400 line-through" : ""}`}>{t.title}</p>
                  {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                  {t.created_by === "copilot" && <Badge className="mt-1 border-orange-300 bg-orange-50 text-orange-800">Created via copilot</Badge>}
                </td>
                <td className="pr-2 py-2">{camp(t.campaign_id)}</td>
                <td className="pr-2 py-2">{owner(t.owner_id)}</td>
                <td className={`pr-2 py-2 tabular-nums ${t.due_date && t.due_date < today && t.status !== "done" ? "font-semibold text-orange-700" : ""}`}>{t.due_date ?? "–"}</td>
                <td className="pr-2 py-2 capitalize">{t.priority}</td>
                <td className="pr-2 py-2">
                  <select
                    aria-label={`Status of ${t.title}`}
                    className="rounded border border-stone-300 px-1 py-0.5 text-xs"
                    value={t.status}
                    onChange={async (e) => {
                      try { await mutate(`/api/tasks/${t.id}`, "PATCH", { status: e.target.value }); } catch (x) { setErr(String(x)); }
                    }}
                  >
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="whitespace-nowrap py-2">
                  <Button variant="ghost" onClick={() => setEditing(t.id)}>Edit</Button>
                  <Button variant="ghost" onClick={async () => { if (confirm(`Delete task "${t.title}"?`)) { try { await mutate(`/api/tasks/${t.id}`, "DELETE"); } catch (x) { setErr(String(x)); } } }}>Delete</Button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
