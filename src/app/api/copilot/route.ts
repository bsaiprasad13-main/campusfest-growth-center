import { NextResponse } from "next/server";
import { CopilotUnavailable, runAgent, type ChatTurn } from "@/lib/copilot/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let b: { message?: string; history?: ChatTurn[]; asOf?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const message = (b.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "message is too long" }, { status: 400 });
  const history = Array.isArray(b.history) ? b.history.filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") : [];
  try {
    return NextResponse.json(await runAgent(history, message, b.asOf));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NO_KEY") {
      return NextResponse.json(
        { error: "The copilot needs an AI key. Add GROQ_API_KEY (or GEMINI_API_KEY) to .env (local) or the host's environment variables, then restart." },
        { status: 503 },
      );
    }
    if (e instanceof CopilotUnavailable) {
      console.warn("copilot unavailable:", e.detail);
      return NextResponse.json({ error: e.message, detail: e.detail, retry_after_s: e.retryAfterS }, { status: e.retryAfterS != null ? 429 : 503 });
    }
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
