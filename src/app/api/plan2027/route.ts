import { body, handle } from "@/lib/api";
import { updatePlan2027 } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  return handle(async () => updatePlan2027(await body<Record<string, unknown>>(req)));
}
