import { body, handle } from "@/lib/api";
import { addTargetVersion } from "@/lib/mutations";
import type { TargetRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => addTargetVersion(await body<Omit<TargetRow, "effective_at"> & { effective_date: string }>(req)));
}
