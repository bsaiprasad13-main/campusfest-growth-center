"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ClientState } from "@/lib/state";

interface Ctx {
  state: ClientState | null;
  asOf: string | null;
  setAsOf: (d: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
  mutate: (url: string, method: string, body?: unknown) => Promise<unknown>;
  copilotOpen: boolean;
  setCopilotOpen: (b: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ClientState | null>(null);
  const [asOf, setAsOfState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const load = useCallback(async (d: string | null) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/snapshot${d ? `?asOf=${d}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to load");
      setState(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("asOf"); } catch {}
    setAsOfState(saved);
    load(saved);
  }, [load]);

  const setAsOf = (d: string) => {
    setAsOfState(d);
    try { localStorage.setItem("asOf", d); } catch {}
    load(d);
  };

  const refresh = useCallback(() => load(asOf), [load, asOf]);

  const mutate = useCallback(
    async (url: string, method: string, body?: unknown) => {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`);
      await load(asOf);
      return j;
    },
    [load, asOf],
  );

  return (
    <AppCtx.Provider value={{ state, asOf, setAsOf, refresh, loading, error, mutate, copilotOpen, setCopilotOpen }}>
      {children}
    </AppCtx.Provider>
  );
}
