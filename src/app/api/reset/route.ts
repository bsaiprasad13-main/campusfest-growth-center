import { handle } from "@/lib/api";
import { resetData } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    await resetData();
    return { ok: true };
  });
}
