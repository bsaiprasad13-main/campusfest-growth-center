"use client";
import { DECISION_STYLE } from "@/lib/format";

export function Card({ title, subtitle, children, className = "", right }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, progress, tone = "default" }: { label: string; value: string; sub?: string; progress?: number | null; tone?: "default" | "good" | "bad" }) {
  const bar = progress == null ? null : Math.max(0, Math.min(1, progress));
  const color = tone === "bad" ? "bg-orange-500" : tone === "good" ? "bg-blue-600" : "bg-slate-700";
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      {bar != null && (
        <div className="mt-2 h-1.5 w-full rounded bg-stone-200" role="progressbar" aria-valuenow={Math.round(bar * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-1.5 rounded ${color}`} style={{ width: `${bar * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function DecisionChip({ status, title }: { status: string; title?: string }) {
  const s = DECISION_STYLE[status] ?? DECISION_STYLE.insufficient_data;
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs text-slate-700 ${className}`}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", type = "button", disabled, className = "" }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; type?: "button" | "submit"; disabled?: boolean; className?: string }) {
  const v = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "border border-stone-300 bg-white text-slate-800 hover:bg-stone-50",
    danger: "border border-orange-300 bg-white text-orange-800 hover:bg-orange-50",
    ghost: "text-slate-600 hover:bg-stone-100",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${v} ${className}`}>
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-slate-500">{children}</p>;
}
