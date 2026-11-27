import { body, handle } from "@/lib/api";
import { deleteDaily, upsertDaily, type DailyInput } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => upsertDaily({ ...(await body<DailyInput>(req)), activity_id: id }));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => deleteDaily(id));
}
