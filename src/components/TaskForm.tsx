"use client";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { Button, Field, inputCls } from "./ui";
import type { Task } from "@/lib/types";

export function TaskForm({ initial, onDone, fixedCampaign }: { initial?: Partial<Task>; onDone?: () => void; fixedCampaign?: string }) {
  const { state, mutate } = useApp();
  const [f, setF] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    campaign_id: fixedCampaign ?? initial?.campaign_id ?? "",
    owner_id: initial?.owner_id ?? "",
    due_date: initial?.due_date ?? "",
    priority: initial?.priority ?? "medium",
    status: initial?.status ?? "todo",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = { ...f, campaign_id: f.campaign_id || null, owner_id: f.owner_id || null, due_date: f.due_date || null };
      if (initial?.id) await mutate(`/api/tasks/${initial.id}`, "PATCH", payload);
      else await mutate("/api/tasks", "POST", payload);
      if (!initial?.id) setF((x) => ({ ...x, title: "", description: "" }));
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 md:grid-cols-6">
      <div className="md:col-span-3"><Field label="Task"><input className={inputCls} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Move ₹20k from Paid Social to Referrals" required /></Field></div>
      <div className="md:col-span-3"><Field label="Details"><input className={inputCls} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Why, and what done looks like" /></Field></div>
      {!fixedCampaign && (
        <Field label="Campaign">
          <select className={inputCls} value={f.campaign_id} onChange={(e) => set("campaign_id", e.target.value)}>
            <option value="">None</option>
            {state.snapshot.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Owner">
        <select className={inputCls} value={f.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
          <option value="">Unassigned</option>
          {state.owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
        </select>
      </Field>
      <Field label="Due"><input type="date" className={inputCls} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
      <Field label="Priority">
        <select className={inputCls} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </Field>
      {initial?.id && (
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
          </select>
        </Field>
      )}
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}>{initial?.id ? "Save" : "Add task"}</Button>
        {onDone && initial?.id && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
      {err && <p className="text-sm text-orange-700 md:col-span-6">{err}</p>}
    </form>
  );
}
