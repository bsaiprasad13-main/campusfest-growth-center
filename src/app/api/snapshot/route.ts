import { handle } from "@/lib/api";
import { loadState, toClient } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const asOf = new URL(req.url).searchParams.get("asOf");
  return handle(async () => toClient(await loadState(asOf)));
}
