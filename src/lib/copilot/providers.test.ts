import { afterEach, describe, expect, it, vi } from "vitest";
import { gemini, type NMsg } from "./providers";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini taking over mid-answer", () => {
  it("replays another model's tool steps as plain text, not as function calls", async () => {
    let sent: { contents: { role: string; parts: Record<string, unknown>[] }[] } | null = null;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Answer" }] } }], usageMetadata: { totalTokenCount: 10 } }), { status: 200 });
    });
    const msgs: NMsg[] = [
      { role: "user", text: "How many attendees?" },
      { role: "assistant", text: "", toolCalls: [{ id: "call_1", name: "get_overview", args: { as_of: "2025-04-20" } }] },
      { role: "tool", toolCallId: "call_1", name: "get_overview", result: { unique_attendees: 2050 } },
    ];
    const r = await gemini("test-key", ["gemini-3.5-flash-lite"]).call("gemini-3.5-flash-lite", "system", msgs, [], { signal: AbortSignal.timeout(5000), requireTool: false });
    expect(r.ok).toBe(true);
    const parts = sent!.contents.flatMap((c) => c.parts);
    expect(parts.some((p) => "functionCall" in p || "functionResponse" in p)).toBe(false);
    expect(JSON.stringify(sent!.contents)).toContain("get_overview");
    expect(JSON.stringify(sent!.contents)).toContain("2050");
    expect(sent!.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });
});
