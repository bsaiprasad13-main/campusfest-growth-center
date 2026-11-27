/**
 * Persistence. The original dataset ships read-only with the app (data/seed).
 * Edits are stored as table OVERRIDES plus the app state (tasks, plans, settings, audit).
 * Effective dataset = seed with overridden tables swapped in. Reset = drop overrides.
 *
 * Backends:
 *  - Supabase (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY are set):
 *      table kv(key text primary key, value jsonb, updated_at timestamptz). See supabase/schema.sql.
 *  - Local JSON files in data/store (default for local development).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { initialAppState, loadSeedDataset } from "./seed";
import type { AppState, Dataset, SourceTable } from "./types";
import { SOURCE_TABLES } from "./types";

export const EDITABLE_TABLES: SourceTable[] = ["campaigns", "campaign_daily", "targets"];

interface Backend {
  name: string;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

class FileBackend implements Backend {
  name = "local-files";
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(key: string) {
    return path.join(this.dir, `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
  }
  async get<T>(key: string) {
    const f = this.file(key);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf-8")) as T) : null;
  }
  async set(key: string, value: unknown) {
    const f = this.file(key);
    fs.writeFileSync(f + ".tmp", JSON.stringify(value));
    fs.renameSync(f + ".tmp", f);
  }
  async del(key: string) {
    const f = this.file(key);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

class SupabaseBackend implements Backend {
  name = "supabase";
  constructor(private sb: SupabaseClient) {}
  async get<T>(key: string) {
    const { data, error } = await this.sb.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return (data?.value as T) ?? null;
  }
  async set(key: string, value: unknown) {
    const { error } = await this.sb.from("kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(`Supabase write failed: ${error.message}`);
  }
  async del(key: string) {
    const { error } = await this.sb.from("kv").delete().eq("key", key);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }
}

function makeBackend(): Backend {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (url && key) return new SupabaseBackend(createClient(url, key, { auth: { persistSession: false } }));
  // On read-only hosts (e.g. Vercel without Supabase) fall back to /tmp: works, but is not durable.
  const dir = process.env.VERCEL ? "/tmp/growth-center-store" : path.join(process.cwd(), "data", "store");
  return new FileBackend(dir);
}

// ---- module-level singletons ----
let backend: Backend | null = null;
let seed: Dataset | null = null;
const be = () => (backend ??= makeBackend());
const seedData = () => (seed ??= loadSeedDataset());

export function storageName() {
  return be().name + (process.env.VERCEL && be().name === "local-files" ? " (temporary /tmp: connect Supabase for durable saves)" : "");
}

export async function getDataset(): Promise<Dataset> {
  const base = seedData();
  const out = { ...base } as Record<string, unknown>;
  for (const t of EDITABLE_TABLES) {
    const o = await be().get<unknown[]>(`table:${t}`);
    if (o) out[t] = o;
  }
  return out as unknown as Dataset;
}

export async function getApp(): Promise<AppState> {
  const a = await be().get<AppState>("app");
  if (a) return a;
  const fresh = initialAppState(seedData());
  await be().set("app", fresh);
  return fresh;
}

// Serialize writes inside this process so read-modify-write cycles don't interleave.
let chain: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export async function saveTable(t: SourceTable, rows: unknown[]) {
  if (!EDITABLE_TABLES.includes(t)) throw new Error(`Table ${t} is read-only in this app.`);
  await be().set(`table:${t}`, rows);
}

export async function saveApp(a: AppState) {
  await be().set("app", a);
}

export async function resetAll() {
  for (const t of SOURCE_TABLES) await be().del(`table:${t}`);
  await be().set("app", initialAppState(seedData()));
}
