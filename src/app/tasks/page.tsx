"use client";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";
import { Card, inputCls } from "@/components/ui";

export default function Tasks() {
  const { state } = useApp();
  const [status, setStatus] = useState("open");
  const [owner, setOwner] = useState("");
  const [campaign, setCampaign] = useState("");
  if (!state) return null;
  const today = new Date().toISOString().slice(0, 10);
  const tasks = state.tasks.filter(
    (t) =>
      (status === "all" || (status === "open" ? t.status !== "done" : t.status === status)) &&
      (!owner || t.owner_id === owner) &&
      (!campaign || t.campaign_id === campaign),
  );
  const open = state.tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && t.due_date < today);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-slate-500">
          {open.length} open · {overdue.length} overdue · {state.tasks.filter((t) => t.created_by === "copilot").length} created from copilot suggestions
        </p>
      </div>
      <Card title="New task"><TaskForm /></Card>
      <Card
        title="Action items"
        right={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Filter by status" className={`${inputCls} w-36`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option><option value="all">All</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select>
            <select aria-label="Filter by owner" className={`${inputCls} w-40`} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              {state.owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </select>
            <select aria-label="Filter by campaign" className={`${inputCls} w-44`} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {state.snapshot.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
            </select>
          </div>
        }
      >
        <TaskList tasks={tasks} />
      </Card>
    </div>
  );
}
