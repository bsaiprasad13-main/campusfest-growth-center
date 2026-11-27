"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import { Copilot } from "./Copilot";
import { PHASE_LABEL } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/diagnose", label: "Diagnose" },
  { href: "/plan", label: "Plan & decide" },
  { href: "/tasks", label: "Tasks" },
  { href: "/data", label: "Data & audit" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { state, asOf, setAsOf, loading, error, copilotOpen, setCopilotOpen } = useApp();
  const s = state?.snapshot;
  return (
    <div className="flex min-h-screen bg-stone-100 text-slate-900">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-slate-900 text-stone-100 md:flex">
        <div className="px-4 py-5">
          <p className="text-xs font-semibold tracking-widest text-orange-300">GROWTH CENTER</p>
          <p className="mt-1 text-sm text-stone-300">{s?.event.name ?? "CampusFest"} · attendee growth</p>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-2 text-sm ${active ? "bg-white/10 font-semibold text-white" : "text-stone-300 hover:bg-white/5"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-4 py-4 text-xs text-stone-400">Storage: {state?.storage ?? "…"}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-2 py-1 text-xs text-slate-700 hover:bg-stone-100">{n.label}</Link>
            ))}
          </nav>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>Data as of end of</span>
            <input
              type="date"
              className="rounded-lg border border-stone-300 px-2 py-1 text-sm"
              value={asOf ?? s?.as_of ?? ""}
              min={s?.event.history_start}
              max={s?.event.history_end}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
            />
            <span className="text-xs text-slate-400">IST</span>
          </label>
          {s && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-700">
              {PHASE_LABEL[s.event.phase]}
              {s.event.phase === "pre_event" ? ` · ${s.event.days_to_event} days to go` : ""}
            </span>
          )}
          {loading && <span className="text-xs text-slate-400">Updating…</span>}
          {error && <span className="text-xs text-orange-700">Error: {error}</span>}
          <button
            onClick={() => setCopilotOpen(!copilotOpen)}
            className="ml-auto rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700"
          >
            {copilotOpen ? "Close copilot" : "Ask the copilot"}
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 p-4 md:p-6">{state ? children : <p className="text-sm text-slate-500">{error ? `Could not load data: ${error}` : "Loading data…"}</p>}</main>
          {copilotOpen && <Copilot />}
        </div>
      </div>
    </div>
  );
}
