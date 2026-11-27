import { body, handle } from "@/lib/api";
import { updateSettings } from "@/lib/mutations";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  return handle(async () => updateSettings(await body<Partial<Settings>>(req)));
}
