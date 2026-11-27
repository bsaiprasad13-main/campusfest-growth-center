import { NextResponse } from "next/server";
import { InputError } from "./mutations";

export async function handle<T>(fn: () => Promise<T>) {
  try {
    const out = await fn();
    return NextResponse.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new InputError("Request body must be JSON");
  }
}
